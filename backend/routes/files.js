const router = require('express').Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const db = require('../config/database');
const auth = require('../middleware/auth');
const { storedMime, applyFileDownloadHeaders } = require('../utils/safeFileServe');
const { createStorageDriver } = require('../utils/storage');
const {
  ensureSharedFilesSchema,
  objectKey,
  assertQuota,
  storageUsage,
  hashFileSync,
  readHeadSync,
  readStoredFile,
  upsertSharedFile,
  migrateSharedFilesToDisk,
} = require('../utils/fileStore');

ensureSharedFilesSchema(db);
const driver = createStorageDriver();
migrateSharedFilesToDisk(db, driver);
const uploadDir = path.join(os.tmpdir(), 'teampulse-uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename(_req, _file, cb) {
      cb(null, `up-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
});

const workspaceId = value => (/^[a-zA-Z0-9_-]{1,80}$/.test(String(value || '')) ? String(value) : 'default');

function canAccess(req, owner, workspace) {
  if (String(req.user.id) === String(owner) || req.user.role === 'admin') return true;
  const email = String(req.user.email || '').trim().toLowerCase();
  return !!email && !!db.prepare(`
    SELECT 1 FROM team_access_grants
    WHERE owner_account_id=? AND workspace_id=? AND lower(trim(member_email))=? AND status='active'
    LIMIT 1
  `).get(owner, workspace, email);
}

function unlinkQuiet(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch {}
}

router.get('/usage', auth, (req, res) => {
  const owner = String(req.query.owner_account_id || req.user.id);
  if (!canAccess(req, owner, workspaceId(req.query.workspace_id))) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json(storageUsage(db, owner));
});

router.post('/', auth, upload.single('file'), (req, res) => {
  const tempPath = req.file?.path;
  let moved = false;
  try {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const owner = String(req.body.owner_account_id || req.user.id);
    const workspace = workspaceId(req.body.workspace_id);
    const id = String(req.body.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
    if (!canAccess(req, owner, workspace)) return res.status(403).json({ error: 'forbidden' });
    if (!id) return res.status(400).json({ error: 'invalid_file_id' });
    const existing = db.prepare(
      'SELECT size FROM shared_files WHERE id=? AND owner_account_id=? AND workspace_id=?'
    ).get(id, owner, workspace);
    try {
      assertQuota(db, owner, req.file.size, existing?.size || 0);
    } catch (error) {
      if (error.code === 'storage_quota') {
        return res.status(413).json({ error: 'storage_quota', ...error.usage });
      }
      throw error;
    }
    const head = readHeadSync(tempPath);
    const mime = storedMime(req.file.mimetype, head);
    const sha256 = hashFileSync(tempPath);
    const storageKey = objectKey(owner, workspace, id);
    driver.moveFromPathSync(storageKey, tempPath);
    moved = true;
    const result = upsertSharedFile(db, {
      id,
      owner,
      workspace,
      name: String(req.file.originalname || 'file'),
      mime,
      size: req.file.size,
      storageKey,
      sha256,
      createdBy: req.user.id,
    });
    if (!result.changes) {
      driver.deleteSync(storageKey);
      return res.status(409).json({ error: 'file_id_conflict' });
    }
    res.json({ success: true, id, storage_key: storageKey, sha256 });
  } catch (error) {
    if (error.code === 'storage_quota') {
      return res.status(413).json({ error: 'storage_quota', ...error.usage });
    }
    res.status(500).json({ error: error.message });
  } finally {
    if (!moved) unlinkQuiet(tempPath);
  }
});

router.get('/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM shared_files WHERE id=?').get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'file_not_found' });
  if (!canAccess(req, row.owner_account_id, row.workspace_id)) return res.status(403).json({ error: 'forbidden' });
  let data;
  try {
    data = readStoredFile(row, driver);
  } catch (error) {
    if (error && error.code === 'ENOENT') return res.status(404).json({ error: 'file_not_found' });
    throw error;
  }
  if (!data) return res.status(404).json({ error: 'file_not_found' });
  applyFileDownloadHeaders(res, row.name, row.mime_type, data);
  res.end(data);
});

router.delete('/:id', auth, (req, res) => {
  const row = db.prepare(
    'SELECT owner_account_id, workspace_id, storage_key FROM shared_files WHERE id=?'
  ).get(String(req.params.id));
  if (!row) return res.json({ success: true });
  if (!canAccess(req, row.owner_account_id, row.workspace_id)) return res.status(403).json({ error: 'forbidden' });
  if (row.storage_key) driver.deleteSync(row.storage_key);
  db.prepare('DELETE FROM shared_files WHERE id=?').run(String(req.params.id));
  res.json({ success: true });
});

module.exports = router;
