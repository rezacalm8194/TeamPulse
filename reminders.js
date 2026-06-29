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
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
} catch(e) {}

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

// ── ارسال push به همه دستگاه‌های یه کاربر ─────────────────────
async function pushToUser(accountId, title, body) {
  const subs = db.prepare('SELECT id, endpoint, subscription FROM push_subscriptions WHERE account_id=?').all(accountId);
  if (!subs.length) return;

  const payload = JSON.stringify({ title: '⏰ ' + title, body, icon: '/logo.png', tag: 'todo-' + Date.now() });

  for (const s of subs) {
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

        const key = `${acc.id}_${t.id}_${t.date_jalali}`;
        if (sentSet.has(key)) continue;

        const taskUTC = jalaliToUTC(t.date_jalali, t.time);
        if (!taskUTC) continue;

        const notifUTC = new Date(taskUTC.getTime() - t.remind_min * 60000);
        if (Math.abs(now - notifUTC) <= 60000) {
          console.log(`[Push] → "${t.title}" (account: ${acc.id})`);
          sentSet.add(key);
          await pushToUser(acc.id, t.title, `ساعت ${t.time}${t.note ? ' — ' + t.note.slice(0,50) : ''}`);
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
    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'invalid' });

    // چک کن قبلاً همین endpoint نباشه
    const exists = db.prepare('SELECT id FROM push_subscriptions WHERE account_id=? AND endpoint=?')
      .get(req.user.id, subscription.endpoint);

    if (!exists) {
      db.prepare('INSERT INTO push_subscriptions (id, account_id, endpoint, subscription) VALUES (?,?,?,?)')
        .run(randomUUID(), req.user.id, subscription.endpoint, JSON.stringify(subscription));
    }
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
  await pushToUser(req.user.id, 'تست نوتیفیکیشن TeamPulse', 'اگه این رو میبینی، Push کار می‌کنه! ✅');
  res.json({ success: true });
});

module.exports = router;
