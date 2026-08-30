const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { collectStorageReport } = require('../utils/storageReport');
const { ensureVersionSnapshotSchema, saveVersionSnapshot } = require('../utils/versionSnapshots');

test('storage report is empty when operational tables are missing', () => {
  const db = new Database(':memory:');
  const report = collectStorageReport(db);
  assert.equal(report.files.count, 0);
  assert.equal(report.snapshots.count, 0);
  assert.equal(report.documents.workspaces, 0);
  assert.equal(report.largest_files.length, 0);
});

test('storage report sums file sizes and snapshot metadata without reading blobs', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE shared_files (
      id TEXT PRIMARY KEY,
      owner_account_id TEXT,
      workspace_id TEXT,
      name TEXT,
      mime_type TEXT,
      size INTEGER,
      data BLOB,
      created_by TEXT
    );
    CREATE TABLE user_data (
      account_id TEXT PRIMARY KEY,
      data TEXT,
      data_etag TEXT,
      updated_at TEXT
    );
    CREATE TABLE user_data_parts (
      account_id TEXT NOT NULL,
      part_key TEXT NOT NULL,
      data TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      PRIMARY KEY (account_id, part_key)
    );
  `);
  ensureVersionSnapshotSchema(db);
  db.prepare('INSERT INTO shared_files(id,owner_account_id,workspace_id,name,size,data) VALUES (?,?,?,?,?,?)')
    .run('f1', 'acc-1', 'default', 'photo.jpg', 2048, Buffer.alloc(2048));
  db.prepare("INSERT INTO user_data(account_id,data) VALUES (?,?)").run('acc-1', '{"_layout":"parts"}');
  db.prepare('INSERT INTO user_data_parts(account_id,part_key,data,data_hash) VALUES (?,?,?,?)')
    .run('acc-1', 'todos', JSON.stringify([{ id: 1 }, { id: 2 }]), 'h');
  saveVersionSnapshot(db, 'acc-1', JSON.stringify({ todos: [{ id: 1 }] }), { force: true });

  const report = collectStorageReport(db);
  assert.equal(report.files.count, 1);
  assert.equal(report.files.bytes, 2048);
  assert.equal(report.documents.workspaces, 1);
  assert.equal(report.documents.parts_count, 1);
  assert.ok(report.documents.parts_bytes > 0);
  assert.equal(report.snapshots.count, 1);
  assert.equal(report.largest_files[0].name, 'photo.jpg');
  assert.equal(report.largest_parts[0].part_key, 'todos');
});
