const router = require('express').Router();
const db = require('../config/database');
const auth = require('../middleware/auth');
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');
webpush.setVapidDetails('mailto:notifications@teampulse.ir', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

function ensureWalletTables() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_wallets (
      account_id TEXT PRIMARY KEY,
      balance REAL DEFAULT 0,
      daily_cost REAL DEFAULT 1000,
      gift_given INTEGER DEFAULT 0,
      last_charge_check INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS wallet_charge_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      amount REAL NOT NULL,
      receipt_text TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `).run();
}

function ensureAdminAccountColumns() {
  const cols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
  if (!cols.includes('subscription_until')) {
    db.prepare('ALTER TABLE accounts ADD COLUMN subscription_until TEXT').run();
  }
}

// ── ذخیره تنظیمات ادمین در جدول user_data با کلید ویژه ────────
function getAdminSettings() {
  try {
    const row = db.prepare("SELECT data FROM user_data WHERE account_id='__admin_settings__'").get();
    return row ? JSON.parse(row.data) : { card_number: '', daily_cost: 1000, tutorial_video_url: '' };
  } catch(e) { return { card_number: '', daily_cost: 1000, tutorial_video_url: '' }; }
}

function saveAdminSettings(settings) {
  const existing = db.prepare("SELECT account_id FROM user_data WHERE account_id='__admin_settings__'").get();
  if (existing) {
    db.prepare("UPDATE user_data SET data=?, updated_at=datetime('now') WHERE account_id='__admin_settings__'").run(JSON.stringify(settings));
  } else {
    db.prepare("INSERT INTO user_data (account_id, data, updated_at) VALUES ('__admin_settings__', ?, datetime('now'))").run(JSON.stringify(settings));
  }
}

// نسخه پشتیبان جامع مدیر: اطلاعات احراز هویت (رمز و توکن‌ها) عمداً
// در خروجی قرار نمی‌گیرند، اما داده اصلی برنامه و رکوردهای وابسته هر حساب
// نگهداری می‌شوند تا فایل برای آرشیو و بازیابی فنی کامل باشد.
router.get('/backup/all', auth, adminOnly, (req, res) => {
  try {
    ensureWalletTables();
    ensureAdminAccountColumns();
    const exportedAt = new Date().toISOString();
    const accounts = db.prepare(`
      SELECT id,name,email,business_name,business_type,role,plan,is_active,
             subscription_until,created_at,updated_at
      FROM accounts
      ORDER BY created_at
    `).all();
    const appDataRows = db.prepare(`
      SELECT account_id,data,updated_at
      FROM user_data
      WHERE account_id <> '__admin_settings__'
    `).all();
    const appDataByAccount = new Map(appDataRows.map(row => {
      let data = null;
      try { data = JSON.parse(row.data); } catch (_) { data = row.data; }
      return [String(row.account_id), { data, updated_at: row.updated_at }];
    }));
    const accountTables = [
      'clients', 'staff', 'payments', 'staff_payments', 'sessions', 'tasks',
      'reminders', 'files', 'user_wallets', 'wallet_transactions',
      'wallet_charge_requests'
    ];
    const existingTables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
    );
    const records = {};
    for (const table of accountTables) {
      if (existingTables.has(table)) {
        const rows = db.prepare(`SELECT * FROM ${table} ORDER BY account_id`).all();
        records[table] = table === 'staff'
          ? rows.map(({ password, ...safeStaff }) => safeStaff)
          : rows;
      }
    }
    const adminSettings = getAdminSettings();
    const backup = {
      meta: {
        product: 'TeamPulse',
        type: 'all-users-admin-backup',
        version: '1.0.0',
        exported_at: exportedAt,
        exported_by: req.user.id,
        user_count: accounts.length
      },
      users: accounts.map(account => ({
        account,
        app_data: appDataByAccount.get(String(account.id)) || null
      })),
      records,
      admin_settings: adminSettings
    };
    const stamp = exportedAt.replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename=TeamPulse-all-users-backup-${stamp}.json`);
    res.send(JSON.stringify(backup, null, 2));
  } catch(e) {
    console.error('Admin all-users backup failed:', e);
    res.status(500).json({ error: e.message });
  }
});

function cleanImportedAppData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const clean = { ...data };
  delete clean._gdrive_token;
  delete clean._gdrive_token_expiry;
  delete clean._gcal_token;
  delete clean._gcal_token_expiry;
  return clean;
}

function saveAdminImportedData(accountId, data) {
  const serialized = JSON.stringify(data);
  const existing = db.prepare('SELECT data FROM user_data WHERE account_id=?').get(accountId);
  if (existing) {
    db.prepare('INSERT INTO user_data_versions (account_id,data) VALUES (?,?)').run(accountId, existing.data);
    db.prepare("UPDATE user_data SET data=?,updated_at=datetime('now') WHERE account_id=?").run(serialized, accountId);
  } else {
    db.prepare("INSERT INTO user_data (account_id,data,updated_at) VALUES (?,?,datetime('now'))").run(accountId, serialized);
  }
}

// بازیابی یک کاربر فقط وقتی پذیرفته می‌شود که شناسه و ایمیل داخل فایل
// دقیقاً با حساب مقصد تطابق داشته باشد؛ بنابراین فایل کاربر A هرگز روی B نمی‌نشیند.
router.post('/backup/users/:id/import', auth, adminOnly, (req, res) => {
  try {
    const targetId = String(req.params.id);
    const backup = req.body?.backup;
    const meta = backup?.meta;
    const data = cleanImportedAppData(backup?.data);
    if (meta?.type !== 'single-user-admin-backup' || !data) {
      return res.status(400).json({ error: 'invalid_single_user_backup' });
    }
    const account = db.prepare('SELECT id,email FROM accounts WHERE id=?').get(targetId);
    if (!account) return res.status(404).json({ error: 'account_not_found' });
    const backupId = String(meta.account_id || '');
    const backupEmail = String(meta.account_email || '').trim().toLowerCase();
    if (backupId !== String(account.id) || !backupEmail || backupEmail !== String(account.email).trim().toLowerCase()) {
      return res.status(409).json({ error: 'backup_account_mismatch' });
    }
    const run = db.transaction(() => saveAdminImportedData(targetId, data));
    run();
    res.json({ success: true, account_id: targetId });
  } catch(e) {
    console.error('Admin single-user backup import failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ابتدا تمام نگاشت‌ها بررسی می‌شوند و فقط در صورت تطابق کامل شناسه+ایمیل،
// همه داده‌ها در یک تراکنش واحد جایگزین می‌شوند.
router.post('/backup/all/import', auth, adminOnly, (req, res) => {
  try {
    const backup = req.body?.backup;
    if (backup?.meta?.type !== 'all-users-admin-backup' || !Array.isArray(backup.users) || !backup.users.length) {
      return res.status(400).json({ error: 'invalid_all_users_backup' });
    }
    const seen = new Set();
    const imports = [];
    for (const item of backup.users) {
      const backupAccount = item?.account;
      const accountId = String(backupAccount?.id || '');
      const accountEmail = String(backupAccount?.email || '').trim().toLowerCase();
      const rawData = item?.app_data?.data;
      const data = rawData == null ? null : cleanImportedAppData(rawData);
      if (!accountId || !accountEmail || (rawData != null && !data) || seen.has(accountId)) {
        return res.status(400).json({ error: 'invalid_or_duplicate_backup_user', account_id: accountId || null });
      }
      seen.add(accountId);
      const current = db.prepare('SELECT id,email FROM accounts WHERE id=?').get(accountId);
      if (!current) return res.status(409).json({ error: 'backup_account_not_found', account_id: accountId });
      if (String(current.email).trim().toLowerCase() !== accountEmail) {
        return res.status(409).json({ error: 'backup_account_mismatch', account_id: accountId });
      }
      if (data) imports.push({ accountId, data });
    }
    const run = db.transaction(() => {
      for (const item of imports) saveAdminImportedData(item.accountId, item.data);
    });
    run();
    res.json({ success: true, imported_users: imports.length });
  } catch(e) {
    console.error('Admin all-users backup import failed:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/stats', auth, adminOnly, (req, res) => {
  try {
    ensureWalletTables();
    ensureAdminAccountColumns();
    const users = db.prepare("SELECT a.id,a.name,a.email,a.role,a.plan,a.is_active,a.created_at,a.updated_at,a.subscription_until,(SELECT COUNT(*) FROM clients WHERE account_id=a.id) as client_count,(SELECT COALESCE(SUM(amount),0) FROM payments WHERE account_id=a.id AND status='paid') as total_income FROM accounts a ORDER BY a.created_at DESC").all();
    const one = (sql) => Number(db.prepare(sql).pluck().get() || 0);
    const monthSeries = (table, valueSql='COUNT(*)', dateColumn='created_at', where='1=1') =>
      db.prepare(`SELECT strftime('%Y-%m',${dateColumn}) label, ${valueSql} value FROM ${table} WHERE ${where} AND ${dateColumn}>=date('now','start of month','-5 months') GROUP BY label ORDER BY label`).all();
    const dashboard = {
      totalUsers: users.length,
      totalUsersPrevious: one("SELECT COUNT(*) FROM accounts WHERE created_at < date('now','start of month')"),
      activeToday: one("SELECT COUNT(*) FROM accounts WHERE is_active=1 AND date(updated_at)=date('now')"),
      activeYesterday: one("SELECT COUNT(*) FROM accounts WHERE is_active=1 AND date(updated_at)=date('now','-1 day')"),
      newThisMonth: one("SELECT COUNT(*) FROM accounts WHERE created_at>=date('now','start of month')"),
      newPreviousMonth: one("SELECT COUNT(*) FROM accounts WHERE created_at>=date('now','start of month','-1 month') AND created_at<date('now','start of month')"),
      inactiveUsers: one("SELECT COUNT(*) FROM accounts WHERE is_active=0"),
      inactivePreviousPeriod: one("SELECT COUNT(*) FROM accounts WHERE is_active=0 AND created_at<date('now','start of month')"),
      paidUsers: one("SELECT COUNT(*) FROM accounts WHERE lower(COALESCE(plan,'free')) NOT IN ('free','رایگان','')"),
      paidPreviousPeriod: one("SELECT COUNT(*) FROM accounts WHERE lower(COALESCE(plan,'free')) NOT IN ('free','رایگان','') AND created_at<date('now','start of month')"),
      monthlyRevenue: one("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='paid' AND created_at>=date('now','start of month')"),
      previousMonthlyRevenue: one("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='paid' AND created_at>=date('now','start of month','-1 month') AND created_at<date('now','start of month')"),
      series: {
        registrations: monthSeries('accounts'),
        activity: db.prepare("SELECT date(updated_at) label,COUNT(*) value FROM accounts WHERE is_active=1 AND updated_at>=date('now','-6 days') GROUP BY label ORDER BY label").all(),
        inactive: monthSeries('accounts','COUNT(*)','created_at',"is_active=0"),
        paid: monthSeries('accounts','COUNT(*)','created_at',"lower(COALESCE(plan,'free')) NOT IN ('free','رایگان','')"),
        revenue: monthSeries('payments','COALESCE(SUM(amount),0)','created_at',"status='paid'")
      }
    };
    const settings = getAdminSettings();
    const chargeReqs = db.prepare(`
      SELECT r.id, r.account_id AS user_id, a.email, a.name, r.amount, r.receipt_text, r.status, r.created_at
      FROM wallet_charge_requests r
      LEFT JOIN accounts a ON a.id = r.account_id
      ORDER BY r.created_at DESC
      LIMIT 100
    `).all();
    res.json({ userCount: users.length, users: users.map(u=>({...u,wallet:u.total_income})), dashboard, chargeReqs, settings });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/users', auth, adminOnly, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = req.body.role === 'admin' ? 'admin' : 'user';
    const plan = ['free','basic','pro','enterprise'].includes(req.body.plan) ? req.body.plan : 'free';
    if (!name || !email || password.length < 6) return res.status(400).json({ error: 'invalid user data' });
    if (db.prepare('SELECT id FROM accounts WHERE lower(email)=?').get(email)) return res.status(409).json({ error: 'email already exists' });
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    db.prepare("INSERT INTO accounts (id,name,email,password,role,plan,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,datetime('now'),datetime('now'))")
      .run(id, name, email, passwordHash, role, plan);
    res.status(201).json({ success: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id/role', auth, adminOnly, (req, res) => {
  try {
    db.prepare("UPDATE accounts SET role=?,updated_at=datetime('now') WHERE id=?").run(req.body.role, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id/status', auth, adminOnly, (req, res) => {
  try {
    db.prepare("UPDATE accounts SET is_active=?,updated_at=datetime('now') WHERE id=?").run(req.body.is_active?1:0, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/users/:id', auth, adminOnly, (req, res) => {
  try {
    ensureAdminAccountColumns();
    const user = db.prepare("SELECT id,name,email,role,plan,is_active,created_at,updated_at,subscription_until FROM accounts WHERE id=?").get(req.params.id);
    if (!user) return res.status(404).json({ error: 'not found' });
    const clients = db.prepare("SELECT * FROM clients WHERE account_id=? AND is_archived=0").all(req.params.id);
    const payments = db.prepare("SELECT * FROM payments WHERE account_id=? ORDER BY created_at DESC LIMIT 20").all(req.params.id);
    res.json({ user, clients, payments });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ذخیره تنظیمات سیستم ─────────────────────────────────────
router.put('/settings', auth, adminOnly, (req, res) => {
  try {
    const current = getAdminSettings();
    const updated = {
      ...current,
      card_number: req.body.card_number ?? current.card_number,
      daily_cost: req.body.daily_cost ?? current.daily_cost,
      tutorial_video_url: req.body.tutorial_video_url ?? current.tutorial_video_url,
    };
    saveAdminSettings(updated);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function updateChargeRequestStatus(req, res, forcedStatus) {
  try {
    ensureWalletTables();
    const id = Number(req.params.id);
    const rawStatus = forcedStatus || req.body.status;
    const status = rawStatus === 'approved' ? 'approved' : rawStatus === 'rejected' ? 'rejected' : null;
    if (!id || !status) return res.status(400).json({ error: 'invalid charge request status' });
    const request = db.prepare('SELECT * FROM wallet_charge_requests WHERE id=?').get(id);
    if (!request) return res.status(404).json({ error: 'not found' });
    if (request.status !== 'pending') return res.json({ success: true, already_processed: true });

    const now = Math.floor(Date.now() / 1000);
    const tx = db.transaction(() => {
      db.prepare("UPDATE wallet_charge_requests SET status=?, updated_at=? WHERE id=?").run(status, now, id);
      if (status === 'approved') {
        const wallet = db.prepare('SELECT account_id FROM user_wallets WHERE account_id=?').get(request.account_id);
        if (!wallet) {
          db.prepare(`
            INSERT INTO user_wallets (account_id, balance, daily_cost, gift_given, last_charge_check, created_at, updated_at)
            VALUES (?, 0, 1000, 1, ?, ?, ?)
          `).run(request.account_id, now, now, now);
        }
        db.prepare("UPDATE user_wallets SET balance=balance+?, updated_at=? WHERE account_id=?").run(request.amount, now, request.account_id);
        db.prepare(`
          INSERT INTO wallet_transactions (id, account_id, type, amount, description, created_at)
          VALUES (?, ?, 'charge', ?, ?, ?)
        `).run(randomUUID(), request.account_id, request.amount, req.body.note || 'شارژ تأیید شده', now);
      }
    });
    tx();
    res.json({ success: true, status });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

router.put('/charge-requests/:id', auth, adminOnly, (req, res) => {
  updateChargeRequestStatus(req, res);
});

router.put('/users/:id/profile', auth, adminOnly, (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
    db.prepare("UPDATE accounts SET name=?,email=?,updated_at=datetime('now') WHERE id=?").run(name, email, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id/plan', auth, adminOnly, (req, res) => {
  try {
    ensureAdminAccountColumns();
    const plan = ['free','basic','pro','enterprise'].includes(req.body.plan) ? req.body.plan : 'free';
    db.prepare("UPDATE accounts SET plan=?,updated_at=datetime('now') WHERE id=?").run(plan, req.params.id);
    res.json({ success: true, plan });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/renew', auth, adminOnly, (req, res) => {
  try {
    ensureAdminAccountColumns();
    const days = Math.max(1, Math.min(730, Number(req.body.days) || 30));
    db.prepare(`UPDATE accounts SET subscription_until=datetime(
      CASE WHEN subscription_until IS NOT NULL AND subscription_until > datetime('now')
        THEN subscription_until ELSE datetime('now') END, ?),updated_at=datetime('now') WHERE id=?`)
      .run('+' + days + ' days', req.params.id);
    const row = db.prepare('SELECT subscription_until FROM accounts WHERE id=?').get(req.params.id);
    res.json({ success: true, subscription_until: row?.subscription_until });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/reset-password', auth, adminOnly, (req, res) => {
  try {
    const password = String(req.body.password || '');
    if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
    db.prepare("UPDATE accounts SET password=?,updated_at=datetime('now') WHERE id=?")
      .run(bcrypt.hashSync(password, 10), req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/notify', auth, adminOnly, async (req, res) => {
  try {
    const userIds = Array.isArray(req.body.user_ids) ? req.body.user_ids.filter(Boolean) : [];
    const title = String(req.body.title || 'پیام مدیریت').slice(0, 80);
    const body = String(req.body.body || '').slice(0, 500);
    if (!userIds.length || !body) return res.status(400).json({ error: 'recipients and body are required' });
    const placeholders = userIds.map(() => '?').join(',');
    const subscriptions = db.prepare(`SELECT id,subscription FROM push_subscriptions WHERE account_id IN (${placeholders})`).all(...userIds);
    let sent = 0;
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(JSON.parse(sub.subscription), JSON.stringify({
          title, body, icon:'/logo.png', tag:'admin-' + Date.now(), kind:'admin'
        }));
        sent++;
      } catch(e) {
        if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(sub.id);
      }
    }
    res.json({ success:true, sent, subscriptions:subscriptions.length });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.post('/charge-requests/:id/approve', auth, adminOnly, (req, res) => {
  updateChargeRequestStatus(req, res, 'approved');
});
router.post('/charge-requests/:id/reject', auth, adminOnly, (req, res) => {
  updateChargeRequestStatus(req, res, 'rejected');
});

// حذف کامل و امن یک حساب کاربری و تمام داده‌های وابسته به آن.
// نکته حیاتی: ترتیب حذف باید طوری باشد که همیشه جدول‌های فرزند قبل از
// جدول‌های والد پاک شوند، وگرنه SQLite به‌خاطر FOREIGN KEY جلوی حذف را
// می‌گیرد (همین چیزی که باعث ارور 500 می‌شد). کل عملیات هم داخل یک
// تراکنش اتمیک انجام می‌شود تا اگر جایی خطا بدهد، هیچ داده‌ای از این
// حساب یا حساب‌های دیگر به‌صورت نصفه‌ونیمه حذف یا دست‌خورده نشود.
router.delete('/users/:id', auth, adminOnly, (req, res) => {
  try {
    ensureWalletTables();
    const targetId = req.params.id;
    const target = db.prepare("SELECT email FROM accounts WHERE id=?").get(targetId);
    if (!target) return res.status(404).json({ error: 'not found' });
    if (target.email === 'rezasafarinet1@gmail.com') {
      return res.status(403).json({ error: 'cannot delete main admin' });
    }
    if (targetId === req.user.id) {
      return res.status(403).json({ error: 'cannot delete your own account while logged in' });
    }

    const deleteAccountCascade = db.transaction((accountId) => {
      db.prepare("DELETE FROM payments WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM sessions WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM reminders WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM staff_payments WHERE account_id=?").run(accountId);

      db.prepare("DELETE FROM files WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM tasks WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM wallet_transactions WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM wallet_charge_requests WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM user_wallets WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM sync_events WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM push_subscriptions WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM user_data WHERE account_id=?").run(accountId);

      db.prepare("DELETE FROM clients WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM staff WHERE account_id=?").run(accountId);
      db.prepare("DELETE FROM accounts WHERE id=?").run(accountId);
    });

    deleteAccountCascade(targetId);
    res.json({ success: true });
  } catch(e) {
    console.error('Delete user failed:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
