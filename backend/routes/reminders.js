// routes/reminders.js
// Web Push + ایمیل (ایمیل موقتاً غیرفعاله، فقط push)
// ─────────────────────────────────────────────────────

const router = require('express').Router();
const db = require('../config/database');
const auth = require('../middleware/auth');
const cron = require('node-cron');
const webpush = require('web-push');
const { randomUUID } = require('crypto');

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
      scope TEXT DEFAULT 'owner',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS team_access_grants (
      owner_account_id TEXT NOT NULL,
      member_email TEXT NOT NULL,
      invite_id TEXT,
      permissions TEXT DEFAULT '[]',
      instruction_folders TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_account_id, member_email)
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
ensurePushSubscriptionColumn('scope', "scope TEXT DEFAULT 'owner'");

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getActiveTeamGrant(ownerAccountId, memberEmail) {
  if (!ownerAccountId || !memberEmail) return null;
  const grant = db.prepare(`
    SELECT permissions
    FROM team_access_grants
    WHERE owner_account_id=? AND member_email=? AND status='active'
  `).get(ownerAccountId, memberEmail);
  return grant ? { permissions: parseJsonArray(grant.permissions) } : null;
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
  if (!subs.length) return;

  const payload = JSON.stringify({
    title: '⏰ ' + title,
    body,
    icon: '/logo.png',
    tag: options.tag || 'push-' + Date.now(),
    todoId: options.todoId || null,
    kind: options.kind || 'reminder',
  });
  const sentEndpoints = new Set();

  for (const s of subs) {
    if (sentEndpoints.has(s.endpoint)) continue;
    sentEndpoints.add(s.endpoint);
    try {
      await webpush.sendNotification(JSON.parse(s.subscription), payload);
    } catch (e) {
      // subscription منقضی شده → پاکش کن
      if (e.statusCode === 410 || e.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(s.id);
      }
    }
  }
}

// ── ارسال push فقط به صاحب حساب ───────────────────────────────
async function pushToOwner(accountId, title, body) {
  const ownerEmail = accountEmail(accountId);
  const subs = db.prepare(`
    SELECT id, endpoint, subscription, subscriber_user_id, subscriber_email, scope
    FROM push_subscriptions
    WHERE account_id=?
      AND (scope IS NULL OR scope!='team')
  `).all(accountId).filter(sub => isOwnerSubscription(sub, accountId, ownerEmail));
  await sendPushSubscriptions(subs, title, body);
}

// ── ارسال push تسک به صاحب حساب و پرسنل مرتبط ─────────────────
async function pushTodoToRecipients(accountId, userData, todo, title, body) {
  const ownerEmail = accountEmail(accountId);
  const subs = db.prepare(`
    SELECT id, endpoint, subscription, subscriber_user_id, subscriber_email, member_email, scope
    FROM push_subscriptions
    WHERE account_id=?
  `).all(accountId);
  if (!subs.length) return;

  const allowed = [];
  for (const sub of subs) {
    if (isOwnerSubscription(sub, accountId, ownerEmail)) {
      allowed.push(sub);
      continue;
    }

    const memberEmail = String(sub.member_email || sub.subscriber_email || '').trim().toLowerCase();
    const grant = getActiveTeamGrant(accountId, memberEmail);
    if (!grant) continue;
    if (todoShouldNotifyTeamMember(todo, userData, memberEmail, grant.permissions)) {
      allowed.push(sub);
    }
  }
  await sendPushSubscriptions(allowed, title, body, {
    tag: todo?.id != null ? 'todo-' + todo.id : undefined,
    todoId: todo?.id || null,
    kind: 'todo',
  });
}

// ── Cron: هر دقیقه ─────────────────────────────────────────────
const sentSet = new Set();

cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    const accounts = db.prepare('SELECT id FROM accounts WHERE is_active=1').all();

    for (const acc of accounts) {
      const row = db.prepare('SELECT data FROM user_data WHERE account_id=?').get(acc.id);
      if (!row || !row.data) continue;

      let userData;
      try { userData = JSON.parse(row.data); } catch { continue; }

      for (const t of (userData.todos || [])) {
        if (t.done || t.archived || !t.time || !t.date_jalali || !(t.remind_min > 0)) continue;
        if (!todoBelongsToAccount(t, acc.id)) {
          console.warn(`[Push] skipped foreign todo "${t.title}" (belongs to ${t.owner_id}, not account ${acc.id})`);
          continue;
        }

        const key = `${acc.id}_${t.id}_${t.date_jalali}`;
        if (sentSet.has(key)) continue;

        const taskUTC = jalaliToUTC(t.date_jalali, t.time);
        if (!taskUTC) continue;

        const notifUTC = new Date(taskUTC.getTime() - t.remind_min * 60000);
        if (Math.abs(now - notifUTC) <= 60000) {
          console.log(`[Push] → "${t.title}" (account: ${acc.id})`);
          sentSet.add(key);
          await pushTodoToRecipients(acc.id, userData, t, t.title, `ساعت ${t.time}${t.note ? ' — ' + t.note.slice(0,50) : ''}`);
        }
      }

      const today = iranTodayParts(now);
      for (const h of (userData.habits || [])) {
        if (h.archived || !h.time || !(h.remind_min > 0)) continue;

        const key = `${acc.id}_habit_${h.id}_${today.key}`;
        if (sentSet.has(key)) continue;

        const habitUTC = iranWallTimeToUTC(today.gy, today.gm, today.gd, h.time);
        if (!habitUTC) continue;

        const notifUTC = new Date(habitUTC.getTime() - h.remind_min * 60000);
        if (Math.abs(now - notifUTC) <= 60000) {
          console.log(`[Push] → habit "${h.title}" (account: ${acc.id})`);
          sentSet.add(key);
          await pushToOwner(acc.id, '🔥 ' + h.title, `وقت انجام عادت: ساعت ${h.time}${h.desc ? ' — ' + h.desc.slice(0,50) : ''}`);
        }
      }
    }
  } catch (e) {
    console.error('[Push Cron] Error:', e.message);
  }
});

console.log('[Push] Cron started — checking every minute');

// ── API: ذخیره push subscription از مرورگر ────────────────────
router.post('/subscribe', auth, (req, res) => {
  try {
    const { subscription, ownerAccountId } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'invalid' });

    const requesterEmail = String(req.user.email || '').trim().toLowerCase();
    const requestedOwnerId = String(ownerAccountId || '').trim();
    let accountId = req.user.id;
    let scope = 'owner';
    let memberEmail = null;

    if (requestedOwnerId && requestedOwnerId !== req.user.id) {
      const grant = getActiveTeamGrant(requestedOwnerId, requesterEmail);
      if (!grant) return res.status(403).json({ error: 'team access not allowed' });
      accountId = requestedOwnerId;
      scope = 'team';
      memberEmail = requesterEmail;
    }

    // چک کن قبلاً همین endpoint نباشه
    const exists = db.prepare('SELECT id FROM push_subscriptions WHERE account_id=? AND endpoint=?')
      .get(accountId, subscription.endpoint);

    if (exists) {
      db.prepare(`
        UPDATE push_subscriptions
        SET subscription=?, subscriber_user_id=?, subscriber_email=?, member_email=?, scope=?, created_at=datetime('now')
        WHERE id=?
      `).run(JSON.stringify(subscription), req.user.id, requesterEmail, memberEmail, scope, exists.id);
    } else {
      db.prepare(`
        INSERT INTO push_subscriptions
          (id, account_id, endpoint, subscription, subscriber_user_id, subscriber_email, member_email, scope)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(randomUUID(), accountId, subscription.endpoint, JSON.stringify(subscription), req.user.id, requesterEmail, memberEmail, scope);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── API: حذف push subscription (غیرفعال‌سازی) ────────────────
router.delete('/subscribe', auth, (req, res) => {
  try {
    db.prepare(`
      DELETE FROM push_subscriptions
      WHERE subscriber_user_id=?
         OR (subscriber_user_id IS NULL AND account_id=?)
    `).run(req.user.id, req.user.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: VAPID public key برای مرورگر ─────────────────────────
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ── API: تست push (فقط ادمین) ──────────────────────────────────
router.post('/test-push', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  await pushToOwner(req.user.id, 'تست نوتیفیکیشن TeamPulse', 'اگه این رو میبینی، Push کار می‌کنه! ✅');
  res.json({ success: true });
});

module.exports = router;
