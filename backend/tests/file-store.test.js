const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createLocalDiskDriver } = require('../utils/storage/localDiskDriver');
const {
  PLAN_STORAGE_BYTES,
  planStorageLimit,
  objectKey,
  ensureSharedFilesSchema,
  usedBytes,
  assertQuota,
  migrateSharedFilesToDisk,
  deleteStoredFiles,
  gcOrphanFiles,
  readStoredFile,
} = require('../utils/fileStore');

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

test('plan storage limits match the published quotas', () => {
  assert.equal(planStorageLimit('free'), PLAN_STORAGE_BYTES.free);
  assert.equal(planStorageLimit('basic'), PLAN_STORAGE_BYTES.basic);
  assert.equal(planStorageLimit('pro'), PLAN_STORAGE_BYTES.pro);
  assert.equal(planStorageLimit('enterprise'), PLAN_STORAGE_BYTES.enterprise);
  assert.equal(planStorageLimit('business'), PLAN_STORAGE_BYTES.enterprise);
});

test('migrates sqlite blobs onto disk and drops the data column', () => {
  const db = makeDb();
  db.exec(`
    CREATE TABLE shared_files (
      id TEXT PRIMARY KEY,
      owner_account_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      data BLOB NOT NULL,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.prepare('INSERT INTO shared_files(id,owner_account_id,workspace_id,name,size,data) VALUES (?,?,?,?,?,?)')
    .run('f1', 'acc-1', 'default', 'note.txt', 5, Buffer.from('hello'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-files-'));
  const driver = createLocalDiskDriver(root);
  const result = migrateSharedFilesToDisk(db, driver);
  assert.equal(result.migrated, 1);
  assert.equal(result.droppedBlobColumn, true);
  const row = db.prepare('SELECT storage_key, sha256, size FROM shared_files WHERE id=?').get('f1');
  assert.equal(row.storage_key, objectKey('acc-1', 'default', 'f1'));
  assert.equal(String(driver.readSync(row.storage_key)), 'hello');
  const cols = db.prepare('PRAGMA table_info(shared_files)').all().map(col => col.name);
  assert.equal(cols.includes('data'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('quota rejects growth past the plan limit', () => {
  const db = makeDb();
  db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, plan TEXT)`);
  db.prepare("INSERT INTO accounts(id,plan) VALUES ('acc-1','free')").run();
  ensureSharedFilesSchema(db);
  db.prepare(`
    INSERT INTO shared_files(id,owner_account_id,workspace_id,name,size,storage_key)
    VALUES ('f1','acc-1','default','a.bin',?, 'files/acc-1/default/f1')
  `).run(PLAN_STORAGE_BYTES.free);
  assert.equal(usedBytes(db, 'acc-1'), PLAN_STORAGE_BYTES.free);
  assert.throws(() => assertQuota(db, 'acc-1', 1), { code: 'storage_quota' });
  assertQuota(db, 'acc-1', 10, 10);
});

test('delete and orphan gc remove disk objects', () => {
  const db = makeDb();
  ensureSharedFilesSchema(db);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-files-'));
  const driver = createLocalDiskDriver(root);
  const key = objectKey('acc-1', 'default', 'f1');
  driver.putSync(key, Buffer.from('x'));
  driver.putSync('files/acc-1/default/orphan.bin', Buffer.from('y'));
  db.prepare(`
    INSERT INTO shared_files(id,owner_account_id,workspace_id,name,size,storage_key)
    VALUES ('f1','acc-1','default','a.bin',1,?)
  `).run(key);
  deleteStoredFiles(db, driver, { ownerAccountId: 'acc-1' });
  assert.equal(fs.existsSync(path.join(root, key)), false);
  driver.putSync('files/acc-2/default/lost.bin', Buffer.from('z'));
  const removed = gcOrphanFiles(db, driver);
  assert.ok(removed >= 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('readStoredFile prefers disk over leftover blobs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-files-'));
  const driver = createLocalDiskDriver(root);
  const key = 'files/acc-1/default/f1';
  driver.putSync(key, Buffer.from('disk'));
  const data = readStoredFile({ storage_key: key, data: Buffer.from('blob') }, driver);
  assert.equal(String(data), 'disk');
  fs.rmSync(root, { recursive: true, force: true });
});
