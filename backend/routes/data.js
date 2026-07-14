const router = require('express').Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

db.prepare(`
  CREATE TABLE IF NOT EXISTS user_data_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_user_data_versions_account ON user_data_versions(account_id, created_at)").run();
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

const DATA_ARRAY_KEYS = [
  'students',
  'packages',
  'payments',
  'sessions',
  'families',
  'todos',
  'staff',
  'instructions',
  'team_members',
  'goals',
  'habits'
];

function dataItemCount(data) {
  if (!data || typeof data !== 'object') return 0;
  return DATA_ARRAY_KEYS.reduce((sum, key) => {
    const value = data[key];
    return sum + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

function looksLikeDestructiveOverwrite(previousData, nextData) {
  const previousCount = dataItemCount(previousData);
  const nextCount = dataItemCount(nextData);
  if (previousCount < 3) return false;
  if (nextCount === 0) return true;
  return previousCount >= 10 && nextCount < Math.ceil(previousCount * 0.1);
}

function sanitizeUserDataForStorage(data) {
  if (!data || typeof data !== 'object') return data;
  const clean = Array.isArray(data) ? [...data] : { ...data };
  delete clean._gdrive_token;
  delete clean._gdrive_token_expiry;
  delete clean._gcal_token;
  delete clean._gcal_token_expiry;
  return clean;
}

function canAccessAccount(req, targetId) {
  if (req.user.id === targetId || req.user.role === 'admin') return true;
  const requesterEmail = String(req.user.email || '').trim().toLowerCase();
  if (!requesterEmail) return false;
  const grant = db.prepare(`
    SELECT owner_account_id
    FROM team_access_grants
    WHERE owner_account_id=? AND member_email=? AND status='active'
  `).get(targetId, requesterEmail);
  if (grant) return true;
  const row = db.prepare("SELECT data FROM user_data WHERE account_id=?").get(targetId);
  if (!row?.data) return false;
  try {
    const data = JSON.parse(row.data);
    return (data.team_members || []).some(member =>
      String(member.email || '').trim().toLowerCase() === requesterEmail &&
      member.status !== 'حذف‌شده'
    );
  } catch {
    return false;
  }
}

router.put('/:accountId', auth, (req, res) => {
  try {
    const targetId = req.params.accountId;
    if (!canAccessAccount(req, targetId)) return res.status(403).json({ error: 'forbidden' });
    const { force } = req.body;
    const data = sanitizeUserDataForStorage(req.body.data);
    if (!data) return res.status(400).json({ error: 'no data' });
    const existing = db.prepare("SELECT account_id,data FROM user_data WHERE account_id=?").get(targetId);
    if (existing) {
      let previousData = null;
      try { previousData = JSON.parse(existing.data || 'null'); } catch {}
      if (!force && looksLikeDestructiveOverwrite(previousData, data)) {
        return res.status(409).json({
          error: 'destructive_overwrite_blocked',
          message: 'Refusing to overwrite existing account data with an almost empty payload.'
        });
      }
      const nextData = JSON.stringify(data);
      const run = db.transaction(() => {
        db.prepare("INSERT INTO user_data_versions (account_id,data) VALUES (?,?)").run(targetId, existing.data);
        db.prepare("UPDATE user_data SET data=?,updated_at=datetime('now') WHERE account_id=?").run(nextData, targetId);
        db.prepare(`
          DELETE FROM user_data_versions
          WHERE account_id=?
            AND id NOT IN (
              SELECT id FROM user_data_versions
              WHERE account_id=?
              ORDER BY id DESC
              LIMIT 50
            )
        `).run(targetId, targetId);
      });
      run();
    } else {
      db.prepare("INSERT INTO user_data (account_id,data,updated_at) VALUES (?,?,datetime('now'))").run(targetId, JSON.stringify(data));
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:accountId', auth, (req, res) => {
  try {
    const targetId = req.params.accountId;
    if (!canAccessAccount(req, targetId)) return res.status(403).json({ error: 'forbidden' });
    const row = db.prepare("SELECT data,updated_at FROM user_data WHERE account_id=?").get(targetId);
    if (!row) return res.json({ data: null });
    res.json({ data: sanitizeUserDataForStorage(JSON.parse(row.data)), updated_at: row.updated_at });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
