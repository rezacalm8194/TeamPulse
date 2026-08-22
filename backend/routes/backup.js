const router = require('express').Router();
const auth = require('../middleware/auth');
const db = require('../config/database');
const {
  collectAccountAppBackup,
  hasAppDocumentPayload,
  restoreAccountAppBackup,
} = require('../utils/userBackup');

router.get('/export', auth, (req, res) => {
  try {
    const accountId = req.user.id;
    const account = db.prepare(
      'SELECT id,name,email,business_name,business_type,plan,created_at FROM accounts WHERE id=?'
    ).get(accountId);
    if (!account) return res.status(404).json({ error: 'account_not_found' });
    const exportedAt = new Date().toISOString();
    const backup = collectAccountAppBackup(db, account, exportedAt);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename=teampulse-backup-${exportedAt.slice(0, 10)}.json`);
    res.json(backup);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/import', auth, (req, res) => {
  try {
    const payload = req.body?.data?.meta ? req.body.data : req.body;
    if (!payload || !payload.meta) return res.status(400).json({ error: 'invalid backup file' });
    const accountId = req.user.id;
    const backupAccountId = payload.meta.account_id;
    if (backupAccountId && String(backupAccountId) !== String(accountId)) {
      return res.status(409).json({ error: 'backup_account_mismatch' });
    }
    if (!hasAppDocumentPayload(payload)) {
      return res.status(400).json({ error: 'backup_missing_app_data' });
    }
    const imported = db.transaction(() => restoreAccountAppBackup(db, accountId, payload))();
    res.json({ success: true, imported });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
