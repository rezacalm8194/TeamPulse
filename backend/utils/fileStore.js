const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const PLAN_STORAGE_BYTES = Object.freeze({
  free: 100 * 1024 * 1024,
  basic: 2 * 1024 * 1024 * 1024,
  pro: 10 * 1024 * 1024 * 1024,
  enterprise: 50 * 1024 * 1024 * 1024,
});

function planStorageLimit(plan) {
  const key = String(plan || 'free').trim().toLowerCase();
  if (key === 'business') return PLAN_STORAGE_BYTES.enterprise;
  return PLAN_STORAGE_BYTES[key] || PLAN_STORAGE_BYTES.free;
}

function objectKey(ownerAccountId, workspaceId, fileId) {
  return `files/${ownerAccountId}/${workspaceId}/${fileId}`;
}

function tableColumns(db, table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(col => col.name);
  } catch {
    return [];
  }
}

function ensureSharedFilesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_files (
      id TEXT PRIMARY KEY,
      owner_account_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT,
      sha256 TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_shared_files_owner
      ON shared_files(owner_account_id, workspace_id);
  `);
  const cols = tableColumns(db, 'shared_files');
  if (cols.length && !cols.includes('storage_key')) {
    db.exec('ALTER TABLE shared_files ADD COLUMN storage_key TEXT');
  }
  if (cols.length && !cols.includes('sha256')) {
    db.exec('ALTER TABLE shared_files ADD COLUMN sha256 TEXT');
  }
}

function usedBytes(db, ownerAccountId) {
  return Number(
    db.prepare('SELECT IFNULL(SUM(size),0) FROM shared_files WHERE owner_account_id=?').pluck().get(ownerAccountId) || 0
  );
}

function ownerPlan(db, ownerAccountId) {
  const row = db.prepare('SELECT plan FROM accounts WHERE id=?').get(ownerAccountId);
  return row?.plan || 'free';
}

function storageUsage(db, ownerAccountId) {
  const plan = ownerPlan(db, ownerAccountId);
  const used = usedBytes(db, ownerAccountId);
  const limit = planStorageLimit(plan);
  return { plan, used, limit };
}

function assertQuota(db, ownerAccountId, extraBytes, replacingBytes = 0) {
  const usage = storageUsage(db, ownerAccountId);
  if (usage.used - replacingBytes + extraBytes > usage.limit) {
    const error = new Error('storage_quota');
    error.code = 'storage_quota';
    error.usage = usage;
    throw error;
  }
  return usage;
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function hashFileSync(filePath) {
  return hashBuffer(fs.readFileSync(filePath));
}

function readHeadSync(filePath, max = 1024) {
  const size = fs.statSync(filePath).size;
  const length = Math.min(max, size);
  if (!length) return Buffer.alloc(0);
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(length);
    fs.readSync(fd, head, 0, length, 0);
    return head;
  } finally {
    fs.closeSync(fd);
  }
}

function rebuildWithoutBlobColumn(db) {
  const cols = tableColumns(db, 'shared_files');
  if (!cols.includes('data')) return false;
  db.exec(`
    CREATE TABLE shared_files_meta (
      id TEXT PRIMARY KEY,
      owner_account_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT,
      sha256 TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO shared_files_meta (
      id, owner_account_id, workspace_id, name, mime_type, size, storage_key, sha256, created_by, created_at
    )
    SELECT id, owner_account_id, workspace_id, name, mime_type, size, storage_key, sha256, created_by, created_at
    FROM shared_files;
    DROP TABLE shared_files;
    ALTER TABLE shared_files_meta RENAME TO shared_files;
    CREATE INDEX IF NOT EXISTS idx_shared_files_owner
      ON shared_files(owner_account_id, workspace_id);
  `);
  return true;
}

function migrateSharedFilesToDisk(db, driver) {
  ensureSharedFilesSchema(db);
  const cols = tableColumns(db, 'shared_files');
  let migrated = 0;
  if (cols.includes('data') && driver?.putSync) {
    const select = db.prepare(`
      SELECT id, owner_account_id, workspace_id, data
      FROM shared_files
      WHERE IFNULL(storage_key,'')='' AND data IS NOT NULL AND length(data)>0
      LIMIT 1
    `);
    const update = db.prepare('UPDATE shared_files SET storage_key=?, sha256=? WHERE id=?');
    for (;;) {
      const row = select.get();
      if (!row) break;
      const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data || '');
      const key = objectKey(row.owner_account_id, row.workspace_id, row.id);
      driver.putSync(key, buf);
      update.run(key, hashBuffer(buf), row.id);
      migrated += 1;
    }
  }
  const leftover = cols.includes('data')
    ? db.prepare(`
        SELECT 1 FROM shared_files
        WHERE IFNULL(storage_key,'')='' AND data IS NOT NULL AND length(data)>0
        LIMIT 1
      `).get()
    : null;
  const droppedBlobColumn = leftover ? false : rebuildWithoutBlobColumn(db);
  return { migrated, droppedBlobColumn };
}

function deleteStoredFiles(db, driver, { ownerAccountId, workspaceId } = {}) {
  ensureSharedFilesSchema(db);
  let rows;
  if (workspaceId) {
    rows = db.prepare(
      'SELECT id, storage_key FROM shared_files WHERE owner_account_id=? AND workspace_id=?'
    ).all(ownerAccountId, workspaceId);
    db.prepare('DELETE FROM shared_files WHERE owner_account_id=? AND workspace_id=?').run(ownerAccountId, workspaceId);
  } else {
    rows = db.prepare(
      'SELECT id, storage_key FROM shared_files WHERE owner_account_id=?'
    ).all(ownerAccountId);
    db.prepare('DELETE FROM shared_files WHERE owner_account_id=?').run(ownerAccountId);
  }
  let deleted = 0;
  for (const row of rows) {
    if (row.storage_key && driver?.deleteSync) {
      if (driver.deleteSync(row.storage_key)) deleted += 1;
    }
  }
  return deleted;
}

function gcOrphanFiles(db, driver) {
  if (!driver || driver.kind !== 'local' || !driver.root) return 0;
  const filesRoot = path.join(driver.root, 'files');
  if (!fs.existsSync(filesRoot)) return 0;
  const keep = new Set(
    db.prepare("SELECT storage_key FROM shared_files WHERE IFNULL(storage_key,'')!=''")
      .all()
      .map(row => String(row.storage_key).replace(/\\/g, '/'))
  );
  let deleted = 0;
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(driver.root, full).replace(/\\/g, '/');
      if (!keep.has(rel)) {
        fs.unlinkSync(full);
        deleted += 1;
      }
    }
  };
  walk(filesRoot);
  return deleted;
}

function upsertSharedFile(db, row) {
  const cols = tableColumns(db, 'shared_files');
  if (cols.includes('data')) {
    return db.prepare(`
      INSERT INTO shared_files(
        id, owner_account_id, workspace_id, name, mime_type, size, storage_key, sha256, created_by, data
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        mime_type=excluded.mime_type,
        size=excluded.size,
        storage_key=excluded.storage_key,
        sha256=excluded.sha256,
        data=excluded.data
      WHERE shared_files.owner_account_id=excluded.owner_account_id
        AND shared_files.workspace_id=excluded.workspace_id
    `).run(
      row.id, row.owner, row.workspace, row.name, row.mime, row.size,
      row.storageKey, row.sha256, row.createdBy, Buffer.alloc(0)
    );
  }
  return db.prepare(`
    INSERT INTO shared_files(
      id, owner_account_id, workspace_id, name, mime_type, size, storage_key, sha256, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      mime_type=excluded.mime_type,
      size=excluded.size,
      storage_key=excluded.storage_key,
      sha256=excluded.sha256
    WHERE shared_files.owner_account_id=excluded.owner_account_id
      AND shared_files.workspace_id=excluded.workspace_id
  `).run(
    row.id, row.owner, row.workspace, row.name, row.mime, row.size,
    row.storageKey, row.sha256, row.createdBy
  );
}

function readStoredFile(row, driver) {
  if (row?.storage_key && driver?.readSync) return driver.readSync(row.storage_key);
  if (row?.data != null) return Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data || '');
  return null;
}

module.exports = {
  PLAN_STORAGE_BYTES,
  planStorageLimit,
  objectKey,
  ensureSharedFilesSchema,
  usedBytes,
  storageUsage,
  assertQuota,
  hashBuffer,
  hashFileSync,
  readHeadSync,
  migrateSharedFilesToDisk,
  deleteStoredFiles,
  gcOrphanFiles,
  readStoredFile,
  upsertSharedFile,
};
