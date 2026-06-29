const router = require('express').Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

router.put('/:accountId', auth, (req, res) => {
  try {
    const targetId = req.params.accountId;
    if (req.user.id !== targetId && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'no data' });
    const existing = db.prepare("SELECT account_id FROM user_data WHERE account_id=?").get(targetId);
    if (existing) {
      db.prepare("UPDATE user_data SET data=?,updated_at=datetime('now') WHERE account_id=?").run(JSON.stringify(data), targetId);
    } else {
      db.prepare("INSERT INTO user_data (account_id,data,updated_at) VALUES (?,?,datetime('now'))").run(targetId, JSON.stringify(data));
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:accountId', auth, (req, res) => {
  try {
    const targetId = req.params.accountId;
    if (req.user.id !== targetId && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const row = db.prepare("SELECT data,updated_at FROM user_data WHERE account_id=?").get(targetId);
    if (!row) return res.json({ data: null });
    res.json({ data: JSON.parse(row.data), updated_at: row.updated_at });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
