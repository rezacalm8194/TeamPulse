const router = require('express').Router();
const db = require('../config/database');
const auth = require('../middleware/auth');
const { randomUUID } = require('crypto');

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

router.get('/stats', auth, adminOnly, (req, res) => {
  try {
    ensureWalletTables();
    const users = db.prepare("SELECT a.id,a.name,a.email,a.role,a.plan,a.is_active,a.created_at,(SELECT COUNT(*) FROM clients WHERE account_id=a.id) as client_count,(SELECT COALESCE(SUM(amount),0) FROM payments WHERE account_id=a.id AND status='paid') as total_income FROM accounts a ORDER BY a.created_at DESC").all();
    const settings = getAdminSettings();
    const chargeReqs = db.prepare(`
      SELECT r.id, r.account_id AS user_id, a.email, a.name, r.amount, r.receipt_text, r.status, r.created_at
      FROM wallet_charge_requests r
      LEFT JOIN accounts a ON a.id = r.account_id
      ORDER BY r.created_at DESC
      LIMIT 100
    `).all();
    res.json({ userCount: users.length, users: users.map(u=>({...u,wallet:u.total_income})), chargeReqs, settings });
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
    const user = db.prepare("SELECT id,name,email,role,plan,is_active,created_at FROM accounts WHERE id=?").get(req.params.id);
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

router.post('/charge-requests/:id/approve', auth, adminOnly, (req, res) => {
  updateChargeRequestStatus(req, res, 'approved');
});
router.post('/charge-requests/:id/reject', auth, adminOnly, (req, res) => {
  updateChargeRequestStatus(req, res, 'rejected');
});

router.delete('/users/:id', auth, adminOnly, (req, res) => {
  try {
    const targetId = req.params.id;
    const target = db.prepare("SELECT email FROM accounts WHERE id=?").get(targetId);
    if (!target) return res.status(404).json({ error: 'not found' });
    if (target.email === 'rezasafarinet1@gmail.com') {
      return res.status(403).json({ error: 'cannot delete main admin' });
    }
    db.prepare("DELETE FROM clients WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM payments WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM sessions WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM tasks WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM staff WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM reminders WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM user_data WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM accounts WHERE id=?").run(targetId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
