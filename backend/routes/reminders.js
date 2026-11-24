// routes/reminders.js
// Web Push + ایمیل (ایمیل موقتاً غیرفعاله، فقط push)
// ─────────────────────────────────────────────────────

const router = require('express').Router();
const { displayReminderTitle } = require('../utils/reminderDisplay');
const db = require('../config/database');
const auth = require('../middleware/auth');
const cron = require('node-cron');
const webpush = require('web-push');
const { randomUUID } = require('crypto');
const { ensureTeamAccessSchema, normalizeWorkspaceId, workspaceStorageKey } = require('../utils/teamAccessSchema');
const { loadWorkspaceMeta, loadDocumentParts, loadWorkspaceMetaAsync, loadDocumentPartsAsync, loadWorkspaceDocumentAsync } = require('../utils/documentStore');
const {
  ensurePushDueIndexSchema,
  loadDeliveredKeys,
  upsertPushDueIndex,
  computePushDueIndex,
  replacePushDueItems,
  deletePushDueItem,
  refreshAccountScheduleFromItems,
  listDuePushItems,
  listPushReindexAccountIds,
  markPushDueItemFailed,
  pruneStalePushDueItems,
  prunePushDeliveries,
  loadIndexedKeys,
  parseStorageKey,
  storageKeyFor,
} = require('../utils/pushDueIndex');
const {
  todoShouldNotifyOwner,
  todoShouldNotifyTeamMember,
} = require('../utils/todoPushRecipients');
const { configureWebPush, readVapidKeys } = require('../utils/vapid');
const { logger } = require('../utils/logger');

ensureTeamAccessSchema(db);

const vapidReady = configureWebPush(webpush, process.env, logger);

// ── جدول push_subscriptions باید وجود داشته باشه ──────────────
// اگه وجود نداشت خودش می‌سازه
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      subscription TEXT NOT NULL,
      subscriber_user_id TEXT,
      subscriber_email TEXT,
      member_email TEXT,
      workspace_id TEXT DEFAULT 'default',
      scope TEXT DEFAULT 'owner',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS push_deliveries (
      delivery_key TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      sent_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  ensurePushDueIndexSchema(db);
} catch(e) {}

function ensurePushSubscriptionColumn(name, ddl) {
  try {
    const cols = db.prepare("PRAGMA table_info(push_subscriptions)").all().map(col => col.name);
    if (!cols.includes(name)) db.prepare(`ALTER TABLE push_subscriptions ADD COLUMN ${ddl}`).run();
  } catch (e) {}
}

ensurePushSubscriptionColumn('subscriber_user_id', 'subscriber_user_id TEXT');
ensurePushSubscriptionColumn('subscriber_email', 'subscriber_email TEXT');
ensurePushSubscriptionColumn('member_email', 'member_email TEXT');
ensurePushSubscriptionColumn('workspace_id', "workspace_id TEXT DEFAULT 'default'");
ensurePushSubscriptionColumn('scope', "scope TEXT DEFAULT 'owner'");

try {
  db.prepare(`
    DELETE FROM push_subscriptions
    WHERE (scope IS NULL OR scope!='team')
      AND subscriber_user_id IS NOT NULL
      AND subscriber_user_id!=''
      AND subscriber_user_id!=account_id
  `).run();
  db.prepare(`
    DELETE FROM push_subscriptions
    WHERE (scope IS NULL OR scope!='team')
      AND (subscriber_user_id IS NULL OR subscriber_user_id='')
      AND subscriber_email IS NOT NULL
      AND subscriber_email!=''
      AND lower(subscriber_email) NOT IN (
        SELECT lower(email) FROM accounts WHERE accounts.id=push_subscriptions.account_id
      )
  `).run();
} catch (e) {
  console.warn('[Push] legacy subscription cleanup skipped:', e.message);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadAccountCollections(accountId, keys) {
  const meta = await loadWorkspaceMetaAsync(db, accountId);
  if (!meta) return null;
  if (meta.layout === 'parts') return (await loadDocumentPartsAsync(db, accountId, keys)).data;
  try { return JSON.parse(meta.serialized || 'null'); } catch { return null; }
}

function loadWorkspaceTeamMembers(ownerAccountId, workspaceId) {
  const storageKey = workspaceStorageKey(ownerAccountId, workspaceId);
  const meta = loadWorkspaceMeta(db, storageKey);
  if (!meta) return [];
  try {
    if (meta.layout === 'parts') {
      return loadDocumentParts(db, storageKey, ['team_members']).collections.team_members || [];
    }
    const parsed = JSON.parse(meta.serialized || 'null');
    return Array.isArray(parsed?.team_members) ? parsed.team_members : [];
  } catch {
    return [];
  }
}

function getActiveTeamGrant(ownerAccountId, workspaceId, memberEmail) {
  if (!ownerAccountId || !memberEmail) return null;
  const grant = db.prepare(`
    SELECT permissions, invite_id, staff_id
    FROM team_access_grants
    WHERE owner_account_id=? AND workspace_id=? AND member_email=? AND status='active'
  `).get(ownerAccountId, workspaceId, memberEmail);
  const member = loadWorkspaceTeamMembers(ownerAccountId, workspaceId).find(item =>
    String(item.email || '').trim().toLowerCase() === memberEmail &&
    item.status !== 'حذف‌شده'
  );
  const storedPermissions = grant ? parseJsonArray(grant.permissions) : [];
  const memberPermissions = Array.isArray(member?.permissions) ? member.permissions : [];
  const permissions = memberPermissions.length ? memberPermissions : storedPermissions;
  if (!permissions.length) return null;
  return {
    email: memberEmail,
    permissions,
    staffId: String(grant?.staff_id || member?.staff_id || member?.staffId || '').trim(),
  };
}

// یک تسک ممکنه به‌خاطر یک باگ قدیمی (کش/impersonate آلوده) داخل داده‌ی
// حساب اشتباهی ذخیره شده باشه. سمت کلاینت این تسک‌ها با owner_id نامنطبق
// از لیست مخفی می‌شن، اما کرون Push مستقیم از دیتای خام دیتابیس می‌خونه؛
// پس همین چک باید اینجا هم باشه وگرنه push برای صاحب واقعی حساب می‌ره نه
// صاحب واقعی تسک.
function todoBelongsToAccount(todo, accountId) {
  const taskOwnerId = String(todo?.owner_id || todo?.ownerId || '').trim();
  if (!taskOwnerId) return true;
  if (taskOwnerId === 'local-owner') return true;
  return taskOwnerId === String(accountId);
}

function accountEmail(accountId) {
  try {
    const row = db.prepare('SELECT email FROM accounts WHERE id=?').get(accountId);
    return String(row?.email || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function isOwnerSubscription(sub, accountId, ownerEmail = '') {
  const subscriberUserId = String(sub?.subscriber_user_id || '').trim();
  const subscriberEmail = String(sub?.subscriber_email || '').trim().toLowerCase();
  const scope = String(sub?.scope || 'owner').trim().toLowerCase();

  if (scope === 'team') return false;
  if (subscriberUserId) return subscriberUserId === String(accountId);
  if (subscriberEmail && ownerEmail) return subscriberEmail === ownerEmail;

  // Unknown legacy rows may belong to a team member, so do not send owner-only
  // notifications to them. Re-registering push writes subscriber metadata.
  return false;
}

// A reminder for a task or habit is useless hours later: if the phone is
// offline that long, let the push service drop it. Daily (09:00) reminders
// stay relevant for the rest of the day.
function pushTtlSeconds(kind) {
  if (kind === 'todo' || kind === 'habit') return 2 * 60 * 60;
  if (kind === 'test') return 10 * 60;
  return 12 * 60 * 60;
}

async function sendPushSubscriptions(subs, title, body, options = {}) {
  if (!subs.length) return { sent: 0, failed: 0 };
  if (!vapidReady) return { sent: 0, failed: subs.length };

  const kind = options.kind || 'reminder';
  const prefixByKind = {
    todo: '📋',
    habit: '🔥',
    'financial-reminder': '💳',
    'staff-reminder': '💼',
    'key-event': '🌟',
    test: '🔔',
    reminder: '⏰',
  };
  const cleanTitle = String(title || 'یادآوری').replace(/^[⏰📋🔥💳💼🌟🔔]\s*/u, '');

  const payload = JSON.stringify({
    title: `${prefixByKind[kind] || '🔔'} ${cleanTitle}`,
    body,
    icon: '/app-icon-192-v3.png',
    badge: '/notification-badge.png',
    tag: options.tag || 'push-' + Date.now(),
    todoId: options.todoId || null,
    kind,
    url: options.url || '/app',
  });
  const sentEndpoints = new Set();
  let sent = 0;
  let failed = 0;

  for (const s of subs) {
    if (sentEndpoints.has(s.endpoint)) continue;
    sentEndpoints.add(s.endpoint);
    try {
      await webpush.sendNotification(JSON.parse(s.subscription), payload, {
        TTL: pushTtlSeconds(kind),
        urgency: 'high',
      });
      sent++;
    } catch (e) {
      failed++;
      // subscription منقضی شده → پاکش کن
      // 401/403 normally means this endpoint was created with a different
      // VAPID key. Keeping it makes every later delivery fail forever; the
      // client will create and register a fresh subscription on next launch.
      if ([401, 403, 404, 410].includes(e.statusCode)) {
        db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(s.id);
      } else {
        console.error(`[Push] delivery failed (${e.statusCode || 'unknown'}):`, e.message);
      }
    }
  }
  return { sent, failed };
}

function todoScheduledDate(todo) {
  return todo?.scheduled_date || todo?.scheduledDate || todo?.date_jalali || '';
}

// ── ارسال push فقط به صاحب حساب ───────────────────────────────
async function pushToOwner(accountId, workspaceId, title, body, options = {}) {
  const ownerEmail = accountEmail(accountId);
  const subs = db.prepare(`
    SELECT id, endpoint, subscription, subscriber_user_id, subscriber_email, scope
    FROM push_subscriptions
    WHERE account_id=? AND COALESCE(workspace_id,'default')=?
      AND (scope IS NULL OR scope!='team')
  `).all(accountId, workspaceId).filter(sub => isOwnerSubscription(sub, accountId, ownerEmail));
  return sendPushSubscriptions(subs, title, body, options);
}

// ── ارسال push تسک به صاحب حساب و پرسنل مرتبط ─────────────────
async function pushTodoToRecipients(accountId, workspaceId, userData, todo, title, body) {
  const ownerEmail = accountEmail(accountId);
  const subs = db.prepare(`
    SELECT id, endpoint, subscription, subscriber_user_id, subscriber_email, member_email, scope
    FROM push_subscriptions
    WHERE account_id=? AND COALESCE(workspace_id,'default')=?
  `).all(accountId, workspaceId);
  if (!subs.length) return { sent: 0, failed: 0 };

  const allowed = [];
  for (const sub of subs) {
    if (isOwnerSubscription(sub, accountId, ownerEmail)) {
      if (todoShouldNotifyOwner(todo)) allowed.push(sub);
      continue;
    }

    const memberEmail = String(sub.member_email || sub.subscriber_email || '').trim().toLowerCase();
    const grant = getActiveTeamGrant(accountId, workspaceId, memberEmail);
    if (!grant) continue;
    if (todoShouldNotifyTeamMember(todo, userData, grant)) {
      allowed.push(sub);
    }
  }
  return sendPushSubscriptions(allowed, title, body, {
    tag: todo?.id != null ? 'todo-' + todo.id : undefined,
    todoId: todo?.id || null,
    kind: 'todo',
    url: '/app#todolist',
  });
}

// ── Cron: هر دقیقه ─────────────────────────────────────────────
function claimPushDelivery(deliveryKey, accountId, kind) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO push_deliveries (delivery_key, account_id, kind)
    VALUES (?, ?, ?)
  `).run(deliveryKey, accountId, kind);
  return result.changes > 0;
}

function releasePushDelivery(deliveryKey) {
  db.prepare('DELETE FROM push_deliveries WHERE delivery_key=?').run(deliveryKey);
}

async function deliverOnce(deliveryKey, accountId, kind, send) {
  if (!claimPushDelivery(deliveryKey, accountId, kind)) return false;
  try {
    const result = await send();
    if (!result || result.sent < 1) {
      releasePushDelivery(deliveryKey);
      return false;
    }
    return true;
  } catch (e) {
    releasePushDelivery(deliveryKey);
    throw e;
  }
}

function reminderBody(item, personName = '') {
  const amount = Number(item?.amount || 0);
  const amountText = amount ? ` — مبلغ ${amount.toLocaleString('fa-IR')} تومان` : '';
  const noteText = item?.note ? ` — ${String(item.note).slice(0, 60)}` : '';
  return `${personName ? personName + ' — ' : ''}سررسید ${item.due_date_jalali || ''}${amountText}${noteText}`;
}

let pushCronRunning = false;
const reminderCollectionKeys = ['todos', 'habits', 'habit_logs', 'students', 'staff', 'reminders', 'staff_reminders', 'key_events'];
let lastDeliveryPruneMs = 0;

// accountId here is the document storage key (owner id, or
// `${owner}::workspace::${id}` for a non-default workspace).
function refreshPushDueIndex(accountId, userData, now) {
  const delivered = loadDeliveredKeys(db, accountId);
  const schedule = computePushDueIndex(accountId, userData || {}, now, delivered, {
    ownerId: parseStorageKey(accountId).ownerId,
    knownKeys: loadIndexedKeys(db, accountId),
  });
  let etag = '';
  try { etag = loadWorkspaceMeta(db, accountId)?.etag || ''; } catch (_) {}
  upsertPushDueIndex(db, accountId, etag, schedule);
  replacePushDueItems(db, accountId, schedule.items || []);
}

// Team members are matched to a todo through the workspace's staff /
// team_members rows; only load them when a team device can receive it.
async function loadTodoRecipientData(ownerId, workspaceId) {
  const hasTeamDevice = db.prepare(`
    SELECT 1 FROM push_subscriptions
    WHERE account_id=? AND COALESCE(workspace_id,'default')=? AND scope='team'
    LIMIT 1
  `).get(ownerId, workspaceId);
  if (!hasTeamDevice) return {};
  try {
    return (await loadAccountCollections(storageKeyFor(ownerId, workspaceId), ['team_members', 'staff'])) || {};
  } catch {
    return {};
  }
}

async function deliverIndexedItem(item) {
  // item.accountId is the storage key: deliveries are recorded under it,
  // devices are looked up by owner + workspace.
  const accountId = item.accountId;
  const { ownerId, workspaceId } = parseStorageKey(accountId);
  const payload = item.payload || {};
  const key = item.deliveryKey;
  const kind = item.kind;

  if (kind === 'todo') {
    const todo = payload.todo || {};
    const title = payload.title || todo.title || '';
    const time = payload.time || todo.time || '';
    const note = payload.note || todo.note || '';
    console.log(`[Push] → "${title}" (account: ${accountId})`);
    const recipientData = await loadTodoRecipientData(ownerId, workspaceId);
    return deliverOnce(key, accountId, 'todo', () =>
      pushTodoToRecipients(ownerId, workspaceId, recipientData, todo, title, `ساعت ${time}${note ? ' — ' + String(note).slice(0, 50) : ''}`)
    );
  }

  if (kind === 'habit') {
    const title = payload.title || '';
    const action = String(payload.action || '').trim();
    const body = action
      ? `${action}${payload.time ? ' — ساعت ' + payload.time : ''}`
      : `وقت انجام عادت: ساعت ${payload.time || ''}${payload.desc ? ' — ' + String(payload.desc).slice(0, 50) : ''}`;
    console.log(`[Push] → habit "${title}" (account: ${accountId})`);
    return deliverOnce(key, accountId, 'habit', () =>
      pushToOwner(ownerId, workspaceId, '🔥 ' + title, body, {
        kind: 'habit', tag: payload.custom ? `habit-custom-${payload.habitId}` : `habit-${payload.habitId}`, url: '/app#habits',
      })
    );
  }

  if (kind === 'financial-reminder') {
    return deliverOnce(key, accountId, 'financial-reminder', () =>
      pushToOwner(ownerId, workspaceId, displayReminderTitle(payload.title || 'یادآوری پرداخت'), reminderBody(payload, payload.personName || ''), {
        kind: 'financial-reminder', tag: `financial-${payload.reminderId}`, url: '/app#reminders',
      })
    );
  }

  if (kind === 'staff-reminder') {
    return deliverOnce(key, accountId, 'staff-reminder', () =>
      pushToOwner(ownerId, workspaceId, payload.title || 'یادآوری حقوق', reminderBody(payload, payload.personName || ''), {
        kind: 'staff-reminder', tag: `staff-reminder-${payload.reminderId}`, url: '/app#staff',
      })
    );
  }

  if (kind === 'key-event') {
    const name = payload.personName || '';
    return deliverOnce(key, accountId, 'key-event', () =>
      pushToOwner(ownerId, workspaceId, '🌟 یادآوری رویداد مهم', `${name ? name + ' — ' : ''}${String(payload.text || '').slice(0, 100)}`, {
        kind: 'key-event', tag: `key-event-${payload.eventId}`, url: '/app#students',
      })
    );
  }

  return false;
}

cron.schedule('* * * * *', async () => {
  // node-cron does not wait for a previous async run. Avoid piling up full
  // account scans when push delivery or the host is temporarily slow.
  if (pushCronRunning) return;
  pushCronRunning = true;
  try {
    const now = new Date();
    pruneStalePushDueItems(db, now);
    if (now.getTime() - lastDeliveryPruneMs > 60 * 60 * 1000) {
      lastDeliveryPruneMs = now.getTime();
      prunePushDeliveries(db, now);
    }
    const reindexIds = listPushReindexAccountIds(db, now);

    for (const accountId of reindexIds) {
      await new Promise(resolve => setImmediate(resolve));
      try {
        const userData = await loadAccountCollections(accountId, reminderCollectionKeys);
        refreshPushDueIndex(accountId, userData || {}, now);
      } catch (e) {
        // One broken account must not stop everyone else's reindex.
        console.error('[Push Cron] reindex failed:', accountId, e.message);
        try {
          db.prepare('UPDATE push_due_index SET valid_until_ms=? WHERE account_id=?')
            .run(now.getTime() + 10 * 60 * 1000, accountId);
        } catch (_) {}
      }
    }

    const dueItems = listDuePushItems(db, now);
    for (const item of dueItems) {
      await new Promise(resolve => setImmediate(resolve));
      let delivered = false;
      try {
        delivered = await deliverIndexedItem(item);
      } catch (e) {
        console.error('[Push Cron] item failed:', item.kind, e.message);
      }
      const already = db.prepare('SELECT 1 FROM push_deliveries WHERE delivery_key=?').get(item.deliveryKey);
      if (delivered || already) {
        deletePushDueItem(db, item.deliveryKey);
        refreshAccountScheduleFromItems(db, item.accountId);
      } else {
        // Not delivered to any device: back off so this item cannot keep the
        // head of the queue (LIMIT 250) and starve other accounts.
        markPushDueItemFailed(db, item.deliveryKey, now);
      }
    }
  } catch (e) {
    console.error('[Push Cron] Error:', e.message);
  } finally {
    pushCronRunning = false;
  }
});

console.log('[Push] Cron started — due-index scan every minute');

// ── API: ذخیره push subscription از مرورگر ────────────────────
router.post('/subscribe', auth, (req, res) => {
  try {
    const { subscription, ownerAccountId } = req.body;
    const workspaceId = normalizeWorkspaceId(req.body?.workspaceId || 'default') || 'default';
    if (!subscription?.endpoint) return res.status(400).json({ error: 'invalid' });

    const requesterEmail = String(req.user.email || '').trim().toLowerCase();
    const requestedOwnerId = String(ownerAccountId || '').trim();
    let accountId = req.user.id;
    let scope = 'owner';
    let memberEmail = null;

    if (requestedOwnerId && requestedOwnerId !== req.user.id) {
      const grant = getActiveTeamGrant(requestedOwnerId, workspaceId, requesterEmail);
      if (!grant) return res.status(403).json({ error: 'team access not allowed' });
      accountId = requestedOwnerId;
      scope = 'team';
      memberEmail = requesterEmail;
    }

    // چک کن قبلاً همین endpoint نباشه
    const exists = db.prepare("SELECT id FROM push_subscriptions WHERE account_id=? AND COALESCE(workspace_id,'default')=? AND endpoint=?")
      .get(accountId, workspaceId, subscription.endpoint);

    if (exists) {
      db.prepare(`
        UPDATE push_subscriptions
        SET subscription=?, subscriber_user_id=?, subscriber_email=?, member_email=?, workspace_id=?, scope=?, created_at=datetime('now')
        WHERE id=?
      `).run(JSON.stringify(subscription), req.user.id, requesterEmail, memberEmail, workspaceId, scope, exists.id);
    } else {
      db.prepare(`
        INSERT INTO push_subscriptions
          (id, account_id, endpoint, subscription, subscriber_user_id, subscriber_email, member_email, workspace_id, scope)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(randomUUID(), accountId, subscription.endpoint, JSON.stringify(subscription), req.user.id, requesterEmail, memberEmail, workspaceId, scope);
    }
    try {
      const storageKey = storageKeyFor(accountId, workspaceId);
      const indexed = db.prepare('SELECT 1 FROM push_due_index WHERE account_id=?').get(storageKey);
      if (!indexed) upsertPushDueIndex(db, storageKey, '__pending__', { nextTimedMs: 0, nextDailyMs: 0 });
    } catch (_) {}
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── API: حذف push subscription (غیرفعال‌سازی) ────────────────
router.delete('/subscribe', auth, (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '').trim();
    if (endpoint) {
      db.prepare(`
        DELETE FROM push_subscriptions
        WHERE endpoint=?
          AND (subscriber_user_id=? OR account_id=?)
      `).run(endpoint, req.user.id, req.user.id);
    } else {
      db.prepare(`
        DELETE FROM push_subscriptions
        WHERE subscriber_user_id=?
           OR (subscriber_user_id IS NULL AND account_id=?)
      `).run(req.user.id, req.user.id);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: جایگزینی اشتراک توسط Service Worker ─────────────────
// When the browser rotates a push subscription (pushsubscriptionchange) the
// app may be closed, so the service worker has no login token. The old
// endpoint URL is an unguessable capability issued to this device by the push
// service; it is enough to move that device's rows to the new subscription.
router.post('/resubscribe', (req, res) => {
  try {
    const oldEndpoint = String(req.body?.oldEndpoint || '').trim();
    const subscription = req.body?.subscription;
    const newEndpoint = String(subscription?.endpoint || '').trim();
    if (!oldEndpoint || !newEndpoint || !/^https:\/\//.test(newEndpoint) || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'invalid' });
    }
    const rows = db.prepare('SELECT id, account_id, workspace_id FROM push_subscriptions WHERE endpoint=?').all(oldEndpoint);
    if (!rows.length) return res.status(404).json({ error: 'push_subscription_not_found' });
    const serialized = JSON.stringify(subscription);
    const tx = db.transaction(() => {
      for (const row of rows) {
        const duplicate = db.prepare(`
          SELECT id FROM push_subscriptions
          WHERE account_id=? AND COALESCE(workspace_id,'default')=COALESCE(?,'default') AND endpoint=? AND id!=?
        `).get(row.account_id, row.workspace_id, newEndpoint, row.id);
        if (duplicate) {
          db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(row.id);
        } else {
          db.prepare("UPDATE push_subscriptions SET endpoint=?, subscription=?, created_at=datetime('now') WHERE id=?")
            .run(newEndpoint, serialized, row.id);
        }
      }
    });
    tx();
    res.json({ success: true, moved: rows.length });
  } catch (e) {
    console.error('[Push] resubscribe failed:', e.message);
    res.status(500).json({ error: 'resubscribe_failed' });
  }
});

// ── API: VAPID public key برای مرورگر ─────────────────────────
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: readVapidKeys().publicKey || '' });
});

// ── API: تست push برای دستگاه‌های کاربر فعلی ───────────────────
router.post('/test-push', auth, async (req, res) => {
  const email = String(req.user.email || '').trim().toLowerCase();
  const subs = db.prepare(`
    SELECT id, endpoint, subscription
    FROM push_subscriptions
    WHERE subscriber_user_id=?
       OR (
         (subscriber_user_id IS NULL OR subscriber_user_id='')
         AND account_id=?
         AND lower(COALESCE(subscriber_email, ?))=?
       )
  `).all(req.user.id, req.user.id, email, email);
  if (!subs.length) return res.status(409).json({ error: 'push_subscription_not_found' });
  const result = await sendPushSubscriptions(
    subs,
    'تست نوتیفیکیشن TeamPulse',
    'ارسال اعلان و یادآوری روی این دستگاه درست کار می‌کند ✅',
    { tag: 'push-self-test', kind: 'test' }
  );
  if (result.sent < 1) {
    return res.status(502).json({ error: 'push_delivery_failed', ...result });
  }
  res.json({ success: true, ...result });
});

// Send an immediate notification after a newly-created task is confirmed on
// the server. Scheduled reminders continue to be handled by the cron above.
router.post('/notify-todo-created', auth, async (req, res) => {
  try {
    const accountId = String(req.body?.ownerAccountId || req.user.id || '').trim();
    const workspaceId = normalizeWorkspaceId(req.body?.workspaceId || 'default');
    const todoId = String(req.body?.todoId || '').trim();
    if (!accountId || !workspaceId || !todoId) return res.status(400).json({ error: 'invalid_todo' });

    const requesterEmail = String(req.user.email || '').trim().toLowerCase();
    const isOwner = String(req.user.id) === accountId || req.user.role === 'admin';
    if (!isOwner && !getActiveTeamGrant(accountId, workspaceId, requesterEmail)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const userData = (await loadWorkspaceDocumentAsync(db, workspaceStorageKey(accountId, workspaceId)))?.data;
    if (!userData) return res.status(404).json({ error: 'account_data_not_found' });
    const todo = (userData.todos || []).find(item => String(item?.id) === todoId);
    if (!todo || !todoBelongsToAccount(todo, accountId)) {
      return res.status(404).json({ error: 'todo_not_found' });
    }
    const createdAt = Date.parse(todo.created_at || '');
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > 30 * 60 * 1000) {
      return res.status(409).json({ error: 'todo_notification_window_expired' });
    }
    const createdBy = String(todo.created_by || todo.createdBy || '').trim();
    if (!isOwner && createdBy && createdBy !== String(req.user.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const deliveryKey = `todo-created:${accountId}:${workspaceId}:${todoId}:${todo.created_at || ''}`;
    const schedule = [todoScheduledDate(todo), todo.time].filter(Boolean).join(' ساعت ');
    const body = `${schedule ? schedule + ' — ' : ''}${todo.note ? String(todo.note).slice(0, 80) : 'یک کار جدید ثبت شد'}`;
    const delivered = await deliverOnce(deliveryKey, accountId, 'todo-created', () =>
      pushTodoToRecipients(accountId, workspaceId, userData, todo, `کار جدید: ${todo.title || 'بدون عنوان'}`, body)
    );
    res.json({ success: true, delivered });
  } catch (e) {
    console.error('[Push] todo-created failed:', e.message);
    res.status(500).json({ error: 'todo_notification_failed' });
  }
});

module.exports = router;
