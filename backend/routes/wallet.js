const router = require('express').Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

const MIN_CHARGE_AMOUNT = 10000;
const MAX_CHARGE_AMOUNT = 10000000;

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

function getAdminSettings() {
  try {
    const row = db.prepare("SELECT data FROM user_data WHERE account_id='__admin_settings__'").get();
    return row ? JSON.parse(row.data) : {};
  } catch {
    return {};
  }
}

function ensureWallet(accountId) {
  ensureWalletTables();
  let wallet = db.prepare('SELECT * FROM user_wallets WHERE account_id=?').get(accountId);
  if (wallet) return wallet;

  const settings = getAdminSettings();
  const dailyCost = Number(settings.daily_cost || 1000);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO user_wallets (account_id, balance, daily_cost, gift_given, last_charge_check, created_at, updated_at)
    VALUES (?, 0, ?, 1, ?, ?, ?)
  `).run(accountId, dailyCost, now, now, now);

  return db.prepare('SELECT * FROM user_wallets WHERE account_id=?').get(accountId);
}

router.get('/', auth, (req, res) => {
  try {
    const wallet = ensureWallet(req.user.id);
    const transactions = db.prepare(`
      SELECT id, type, amount, description, created_at
      FROM wallet_transactions
      WHERE account_id=?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.user.id);

    res.json({
      balance: wallet.balance || 0,
      daily_cost: wallet.daily_cost || 1000,
      transactions,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/charge-request', auth, (req, res) => {
  try {
    ensureWallet(req.user.id);
    const amount = Number(req.body.amount);
    const receiptText = String(req.body.receipt_text || '').trim();
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < MIN_CHARGE_AMOUNT) {
      return res.status(400).json({ error: 'minimum amount is 10000' });
    }
    if (amount > MAX_CHARGE_AMOUNT) {
      return res.status(400).json({ error: 'maximum amount is 10000000' });
    }

    const now = Math.floor(Date.now() / 1000);
    const info = db.prepare(`
      INSERT INTO wallet_charge_requests (id, account_id, amount, receipt_text, status, created_at, updated_at)
      VALUES (NULL, ?, ?, ?, 'pending', ?, ?)
    `).run(req.user.id, amount, receiptText, now, now);
    const id = Number(info.lastInsertRowid);

    res.status(201).json({
      success: true,
      request: { id, amount, receipt_text: receiptText, status: 'pending', created_at: now },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
