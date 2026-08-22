// routes/reminders.js
// Web Push + ایمیل (ایمیل موقتاً غیرفعاله، فقط push)
// ─────────────────────────────────────────────────────

const router = require('express').Router();
const db = require('../config/database');
const auth = require('../middleware/auth');
const cron = require('node-cron');
const webpush = require('web-push');
const { randomUUID } = require('crypto');
const { ensureTeamAccessSchema, normalizeWorkspaceId, workspaceStorageKey } = require('../utils/teamAccessSchema');
const { loadWorkspaceMeta, loadDocumentParts, loadWorkspaceDocument } = require('../utils/documentStore');

ensureTeamAccessSchema(db);

// ── VAPID تنظیمات ──────────────────────────────────────────────
webpush.setVapidDetails(
  'mailto:notifications@teampulse.ir',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

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

function loadAccountCollections(accountId, keys) {
  const meta = loadWorkspaceMeta(db, accountId);
  if (!meta) return null;
  if (meta.layout === 'parts') return loadDocumentParts(db, accountId, keys).data;
  try { return JSON.parse(meta.serialized || 'null'); } catch { return null; }
}

function getActiveTeamGrant(ownerAccountId, workspaceId, memberEmail) {
  if (!ownerAccountId || !memberEmail) return null;
  const grant = db.prepare(`
    SELECT permissions
    FROM team_access_grants
    WHERE owner_account_id=? AND workspace_id=? AND member_email=? AND status='active'
  `).get(ownerAccountId, workspaceId, memberEmail);
  if (!grant) return null;
  const storageKey = workspaceStorageKey(ownerAccountId, workspaceId);
  const meta = loadWorkspaceMeta(db, storageKey);
  if (!meta) return { permissions: parseJsonArray(grant.permissions) };
  try {
    const members = meta.layout === 'parts'
      ? (loadDocumentParts(db, storageKey, ['team_members']).collections.team_members || [])
      : (JSON.parse(meta.serialized || 'null')?.team_members || []);
    const member = members.find(item =>
      String(item.email || '').trim().toLowerCase() === memberEmail &&
      item.status !== 'حذف‌شده'
    );
    return member ? { permissions: Array.isArray(member.permissions) ? member.permissions : [] } : null;
  } catch {
    return null;
  }
}

function staffEmail(staff) {
  return String(staff?.email || staff?.work_email || staff?.username || '').trim().toLowerCase();
}

function ownStaffIdsForEmail(data, memberEmail) {
  const rows = Array.isArray(data?.staff) ? data.staff : [];
  return new Set(rows
    .filter(staff => staffEmail(staff) === memberEmail)
    .map(staff => String(staff.id || ''))
    .filter(Boolean));
}

function todoSharedWith(todo) {
  if (Array.isArray(todo?.shared_with)) return todo.shared_with.map(String);
  if (Array.isArray(todo?.sharedWith)) return todo.sharedWith.map(String);
  return [];
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

function todoAssignedToMember(todo, memberEmail, ownStaffIds) {
  const emails = [todo?.assignee_email, todo?.assigneeEmail]
    .filter(Boolean)
    .map(value => String(value).trim().toLowerCase());
  if (emails.includes(memberEmail)) return true;
  const ids = [todo?.assignee_id, todo?.assigneeId, todo?.staff_id, todo?.staffId]
    .filter(value => value != null)
    .map(value => String(value));
  return ids.some(id => ownStaffIds.has(id));
}

function todoShouldNotifyTeamMember(todo, data, memberEmail, permissions) {
  if (!permissions.includes('todolist')) return false;
  const ownStaffIds = ownStaffIdsForEmail(data, memberEmail);
  if (todoAssignedToMember(todo, memberEmail, ownStaffIds)) return true;
  if (permissions.includes('todo_view_clients') && String(todo?.category || '') === 'clients') return true;
  const sharedEmails = todoSharedWith(todo).map(email => email.trim().toLowerCase());
  if (permissions.includes('todo_view_shared') && sharedEmails.includes(memberEmail)) return true;
  if (todo?.visibility === 'team' && permissions.includes('todo_view_shared')) return true;
  return false;
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

// ── تبدیل شمسی به UTC ─────────────────────────────────────────
function jalaliToGregorian(jy, jm, jd) {
  const div = (a, b) => Math.floor(a / b);
  const mod = (a, b) => a - div(a, b) * b;
  let gy = (jy <= 979) ? 621 : 1600;
  jy -= (jy <= 979) ? 0 : 979;
  let days = (365 * jy) + (div(jy, 33) * 8) + div(mod(jy, 33) + 3, 4) + 78 + jd
    + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30 + 186));
  gy += 400 * div(days, 146097);
  days = mod(days, 146097);
  if (days > 36524) { gy += 100 * div(--days, 36524); days = mod(days, 36524); if (days >= 365) days++; }
  gy += 4 * div(days, 1461);
  days = mod(days, 1461);
  gy += div(days - 1, 365);
  if (days > 365) days = mod(days - 1, 365);
  let gd = days + 1;
  const sal_a = [0,31,((gy%4===0&&gy%100!==0)||gy%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  let gm = 0;
  for (gm = 1; gm <= 12 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
  return [gy, gm, gd];
}

function parseJalali(str) {
  if (!str) return null;
  const p = '۰۱۲۳۴۵۶۷۸۹';
  const s = str.split('').map(c => { const i = p.indexOf(c); return i >= 0 ? String(i) : c; }).join('');
  const parts = s.split('/').map(Number);
  return (parts.length === 3 && !parts.some(isNaN)) ? parts : null;
}

function jalaliToUTC(dateJalali, timeStr) {
  const parts = parseJalali(dateJalali);
  if (!parts) return null;
  const [jy, jm, jd] = parts;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  const iranOffsetMs = (3 * 60 + 30) * 60 * 1000; // UTC+3:30
  return new Date(Date.UTC(gy, gm - 1, gd, h, m, 0) - iranOffsetMs);
}

const IRAN_OFFSET_MS = (3 * 60 + 30) * 60 * 1000;

function iranTodayParts(now = new Date()) {
  const iranNow = new Date(now.getTime() + IRAN_OFFSET_MS);
  const gy = iranNow.getUTCFullYear();
  const gm = iranNow.getUTCMonth() + 1;
  const gd = iranNow.getUTCDate();
  return {
    gy, gm, gd,
    key: `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`,
  };
}

function iranWallTimeToUTC(gy, gm, gd, timeStr) {
  const [h, m] = (timeStr || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return new Date(Date.UTC(gy, gm - 1, gd, h, m, 0) - IRAN_OFFSET_MS);
}

async function sendPushSubscriptions(subs, title, body, options = {}) {
  if (!subs.length) return { sent: 0, failed: 0 };

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
    badge: '/notification-badge.svg',
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
      await webpush.sendNotification(JSON.parse(s.subscription), payload);
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
      allowed.push(sub);
      continue;
    }

    const memberEmail = String(sub.member_email || sub.subscriber_email || '').trim().toLowerCase();
    const grant = getActiveTeamGrant(accountId, workspaceId, memberEmail);
    if (!grant) continue;
    if (todoShouldNotifyTeamMember(todo, userData, memberEmail, grant.permissions)) {
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
const PUSH_CATCH_UP_MS = 6 * 60 * 60 * 1000;

function isDueForPush(now, scheduledAt, catchUpMs = PUSH_CATCH_UP_MS) {
  if (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime())) return false;
  const lateBy = now.getTime() - scheduledAt.getTime();
  return lateBy >= 0 && lateBy <= catchUpMs;
}

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

function jalaliDayKey(value) {
  const parts = parseJalali(value);
  if (!parts) return null;
  const [gy, gm, gd] = jalaliToGregorian(parts[0], parts[1], parts[2]);
  return gy * 10000 + gm * 100 + gd;
}

function reminderBody(item, personName = '') {
  const amount = Number(item?.amount || 0);
  const amountText = amount ? ` — مبلغ ${amount.toLocaleString('fa-IR')} تومان` : '';
  const noteText = item?.note ? ` — ${String(item.note).slice(0, 60)}` : '';
  return `${personName ? personName + ' — ' : ''}سررسید ${item.due_date_jalali || ''}${amountText}${noteText}`;
}

let pushCronRunning = false;
const activeAccountsStmt = db.prepare('SELECT id FROM accounts WHERE is_active=1');
const reminderCollectionKeys = ['todos', 'habits', 'students', 'staff', 'reminders', 'staff_reminders', 'key_events'];

cron.schedule('* * * * *', async () => {
  // node-cron does not wait for a previous async run. Avoid piling up full
  // account scans when push delivery or the host is temporarily slow.
  if (pushCronRunning) return;
  pushCronRunning = true;
  try {
    const now = new Date();
    const accounts = activeAccountsStmt.all();

    for (const acc of accounts) {
      // Yield between accounts so static files and API requests are not held
      // behind a long reminder scan in Node's single event loop.
      await new Promise(resolve => setImmediate(resolve));
      const userData = loadAccountCollections(acc.id, reminderCollectionKeys);
      if (!userData) continue;

      for (const t of (userData.todos || [])) {
        const scheduledDate = todoScheduledDate(t);
        if (t.done || t.archived || !t.time || !scheduledDate || !(Number(t.remind_min) > 0)) continue;
        if (!todoBelongsToAccount(t, acc.id)) {
          // This is an expected ownership guard, not an operational warning.
          // Logging every skipped item each minute caused excessive PM2 disk I/O.
          continue;
        }

        const taskUTC = jalaliToUTC(scheduledDate, t.time);
        if (!taskUTC) continue;

        const notifUTC = new Date(taskUTC.getTime() - t.remind_min * 60000);
        if (isDueForPush(now, notifUTC)) {
          const key = `todo:${acc.id}:${t.id}:${scheduledDate}:${t.time}:${t.remind_min}`;
          console.log(`[Push] → "${t.title}" (account: ${acc.id})`);
          await deliverOnce(key, acc.id, 'todo', () =>
            pushTodoToRecipients(acc.id, 'default', userData, t, t.title, `ساعت ${t.time}${t.note ? ' — ' + t.note.slice(0,50) : ''}`)
          );
        }
      }

      const today = iranTodayParts(now);
      for (const h of (userData.habits || [])) {
        if (h.archived || !h.time || !(h.remind_min > 0)) continue;

        const habitUTC = iranWallTimeToUTC(today.gy, today.gm, today.gd, h.time);
        if (!habitUTC) continue;

        const notifUTC = new Date(habitUTC.getTime() - h.remind_min * 60000);
        if (isDueForPush(now, notifUTC)) {
          const key = `habit:${acc.id}:${h.id}:${today.key}:${h.time}:${h.remind_min}`;
          console.log(`[Push] → habit "${h.title}" (account: ${acc.id})`);
          await deliverOnce(key, acc.id, 'habit', () =>
            pushToOwner(acc.id, 'default', '🔥 ' + h.title, `وقت انجام عادت: ساعت ${h.time}${h.desc ? ' — ' + h.desc.slice(0,50) : ''}`, {
              kind: 'habit', tag: `habit-${h.id}`, url: '/app#habits',
            })
          );
        }
      }

      // یادآوری‌های بدون ساعت (مالی، حقوق و رویدادهای مهم) از ساعت ۹
      // به وقت ایران، یک‌بار برای هر سررسید ارسال می‌شوند.
      const iranNow = new Date(now.getTime() + IRAN_OFFSET_MS);
      if (iranNow.getUTCHours() >= 9) {
        const todayDayKey = today.gy * 10000 + today.gm * 100 + today.gd;
        const studentNames = new Map((userData.students || []).map(s => [
          String(s.id), `${s.name || ''} ${s.lname || ''}`.trim(),
        ]));
        const staffNames = new Map((userData.staff || []).map(s => [
          String(s.id), `${s.name || ''} ${s.lname || ''}`.trim(),
        ]));

        for (const r of (userData.reminders || [])) {
          const dueDayKey = jalaliDayKey(r.due_date_jalali);
          if (r.done || !dueDayKey || dueDayKey > todayDayKey) continue;
          const key = `financial:${acc.id}:${r.id}:${r.due_date_jalali}`;
          const name = studentNames.get(String(r.student_id)) || '';
          await deliverOnce(key, acc.id, 'financial-reminder', () =>
            pushToOwner(acc.id, 'default', r.title || 'یادآوری پرداخت', reminderBody(r, name), {
              kind: 'financial-reminder', tag: `financial-${r.id}`, url: '/app#reminders',
            })
          );
        }

        for (const r of (userData.staff_reminders || [])) {
          const dueDayKey = jalaliDayKey(r.due_date_jalali);
          if (r.done || !dueDayKey || dueDayKey > todayDayKey) continue;
          const key = `staff:${acc.id}:${r.id}:${r.due_date_jalali}`;
          const name = staffNames.get(String(r.staff_id)) || '';
          await deliverOnce(key, acc.id, 'staff-reminder', () =>
            pushToOwner(acc.id, 'default', r.title || 'یادآوری حقوق', reminderBody(r, name), {
              kind: 'staff-reminder', tag: `staff-reminder-${r.id}`, url: '/app#staff',
            })
          );
        }

        for (const e of (userData.key_events || [])) {
          const dueDayKey = jalaliDayKey(e.remind_date);
          if (e.remind_done || !dueDayKey || dueDayKey > todayDayKey) continue;
          const key = `key-event:${acc.id}:${e.id}:${e.remind_date}`;
          const name = studentNames.get(String(e.student_id)) || '';
          await deliverOnce(key, acc.id, 'key-event', () =>
            pushToOwner(acc.id, 'default', '🌟 یادآوری رویداد مهم', `${name ? name + ' — ' : ''}${String(e.text || '').slice(0, 100)}`, {
              kind: 'key-event', tag: `key-event-${e.id}`, url: '/app#students',
            })
          );
        }
      }
    }
  } catch (e) {
    console.error('[Push Cron] Error:', e.message);
  } finally {
    pushCronRunning = false;
  }
});

console.log('[Push] Cron started — checking every minute');

// ── API: ذخیره push subscription از مرورگر ────────────────────
router.post('/subscribe', auth, (req, res) => {
  try {
    const { subscription, ownerAccountId } = req.body;
    const workspaceId = normalizeWorkspaceId(req.body?.workspaceId || 'default');
    if (!subscription?.endpoint) return res.status(400).json({ error: 'invalid' });
    if (!workspaceId) return res.status(400).json({ error: 'invalid_workspace' });

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

// ── API: VAPID public key برای مرورگر ─────────────────────────
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
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

    const userData = loadWorkspaceDocument(db, workspaceStorageKey(accountId, workspaceId))?.data;
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
