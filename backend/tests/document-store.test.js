const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  SCALARS_PART,
  PARTS_MARKER,
  splitDocument,
  assembleDocument,
  ensureDocumentStoreSchema,
  loadWorkspaceDocument,
  loadDocumentParts,
  loadWorkspaceMeta,
  writeWorkspaceDocument,
  writeWorkspaceDocumentAsync,
  loadWorkspaceDocumentAsync,
  loadDocumentPartsAsync,
  serializeWorkspaceDocumentAsync,
  parseCollectionInclude,
} = require('../utils/documentStore');
const { applyDocumentPatch } = require('../utils/documentPatch');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_data (
      account_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT
    );
  `);
  ensureDocumentStoreSchema(db);
  return db;
}

test('split/assemble round-trips collections separately from scalars', () => {
  const source = {
    students: [{ id: 1, name: 'A' }],
    todos: [{ id: 10 }],
    meta: { title: 'x' },
    _lastSaved: 9,
  };
  const { scalars, collections } = splitDocument(source);
  assert.deepEqual(collections.students, source.students);
  assert.equal(scalars.meta.title, 'x');
  assert.deepEqual(assembleDocument(scalars, collections), source);
});

test('writing a document stores collections as separate SQLite parts', () => {
  const db = makeDb();
  const data = {
    students: [{ id: 1 }, { id: 2 }],
    todos: [{ id: 10, title: 'keep' }],
    _lastSaved: 1,
  };
  const first = writeWorkspaceDocument(db, 'acc-1', data, { replaceAll: true });
  const row = db.prepare('SELECT data, data_etag FROM user_data WHERE account_id=?').get('acc-1');
  assert.equal(row.data, PARTS_MARKER);
  assert.equal(row.data_etag, first.etag);
  const parts = db.prepare('SELECT part_key FROM user_data_parts WHERE account_id=? ORDER BY part_key').all('acc-1');
  assert.deepEqual(parts.map(p => p.part_key), [SCALARS_PART, 'students', 'todos'].sort());
  const loaded = loadWorkspaceDocument(db, 'acc-1');
  assert.equal(loaded.layout, 'parts');
  assert.equal(loaded.data.todos[0].title, 'keep');
  assert.equal(loaded.etag, first.etag);
});

test('a later patch stringify/writes only the changed collection', () => {
  const db = makeDb();
  writeWorkspaceDocument(db, 'acc-1', {
    students: Array.from({ length: 50 }, (_, i) => ({ id: i, name: 'S' + i })),
    todos: [{ id: 10, title: 'old' }],
    _lastSaved: 1,
  }, { replaceAll: true });
  const beforeStudents = db.prepare(
    'SELECT data, data_hash, updated_at FROM user_data_parts WHERE account_id=? AND part_key=?'
  ).get('acc-1', 'students');

  const previous = loadDocumentParts(db, 'acc-1', ['todos']).data;
  const next = applyDocumentPatch(previous, {
    collections: { todos: { upsert: [{ id: 10, title: 'new' }], delete: [] } },
    scalars: { _lastSaved: 2 },
  });
  writeWorkspaceDocument(db, 'acc-1', next, { replaceAll: false });

  const afterStudents = db.prepare(
    'SELECT data, data_hash, updated_at FROM user_data_parts WHERE account_id=? AND part_key=?'
  ).get('acc-1', 'students');
  assert.equal(afterStudents.data, beforeStudents.data);
  assert.equal(afterStudents.data_hash, beforeStudents.data_hash);
  const loaded = loadWorkspaceDocument(db, 'acc-1');
  assert.equal(loaded.data.todos[0].title, 'new');
  assert.equal(loaded.data.students.length, 50);
  assert.equal(loaded.data._lastSaved, 2);
});

test('legacy blob documents still load until the first write migrates them', () => {
  const db = makeDb();
  const blob = JSON.stringify({ todos: [{ id: 1, title: 'blob' }], students: [{ id: 9 }] });
  db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)').run('acc-2', blob);
  const loaded = loadWorkspaceDocument(db, 'acc-2');
  assert.equal(loaded.layout, 'blob');
  assert.equal(loaded.data.todos[0].title, 'blob');
  const meta = loadWorkspaceMeta(db, 'acc-2');
  assert.equal(meta.layout, 'blob');
  writeWorkspaceDocument(db, 'acc-2', loaded.data, { replaceAll: true });
  assert.equal(loadWorkspaceMeta(db, 'acc-2').layout, 'parts');
  assert.equal(loadWorkspaceDocument(db, 'acc-2').data.students[0].id, 9);
});

test('async write/load yields the same parts document as the sync path', async () => {
  const db = makeDb();
  const data = {
    students: Array.from({ length: 20 }, (_, i) => ({ id: i, name: 'S' + i })),
    todos: [{ id: 10, title: 'keep' }],
    _lastSaved: 1,
  };
  const written = await writeWorkspaceDocumentAsync(db, 'acc-async', data, { replaceAll: true });
  const loaded = await loadWorkspaceDocumentAsync(db, 'acc-async');
  assert.equal(loaded.layout, 'parts');
  assert.equal(loaded.etag, written.etag);
  assert.equal(loaded.data.students.length, 20);
  assert.equal(loaded.data.todos[0].title, 'keep');
  const parts = await loadDocumentPartsAsync(db, 'acc-async', ['todos']);
  assert.equal(parts.data.todos[0].title, 'keep');
  assert.equal(Array.isArray(parts.data.students), false);
});

test('file-backed async path round-trips through a worker thread', async t => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { shutdownDocumentStoreWorkers } = require('../utils/documentStoreThread');
  const file = path.join(os.tmpdir(), `teampulse-docstore-${process.pid}-${Date.now()}.db`);
  const db = new Database(file);
  t.after(async () => {
    await shutdownDocumentStoreWorkers();
    try { db.close(); } catch (_) { /* ignore */ }
    try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
    try { fs.unlinkSync(`${file}-wal`); } catch (_) { /* ignore */ }
    try { fs.unlinkSync(`${file}-shm`); } catch (_) { /* ignore */ }
  });
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE user_data (
      account_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT
    );
  `);
  ensureDocumentStoreSchema(db);
  const data = {
    students: Array.from({ length: 30 }, (_, i) => ({ id: i, name: 'W' + i })),
    todos: [{ id: 7, title: 'worker' }],
  };
  const written = await writeWorkspaceDocumentAsync(db, 'acc-worker', data, { replaceAll: true });
  const loaded = await loadWorkspaceDocumentAsync(db, 'acc-worker');
  assert.equal(loaded.etag, written.etag);
  assert.equal(loaded.data.todos[0].title, 'worker');
  assert.equal(loaded.data.students.length, 30);
  const serialized = await serializeWorkspaceDocumentAsync(db, 'acc-worker');
  assert.equal(JSON.parse(serialized).todos[0].title, 'worker');
});

test('parseCollectionInclude keeps only safe part keys', () => {
  assert.equal(parseCollectionInclude(undefined), null);
  assert.equal(parseCollectionInclude('*'), null);
  assert.deepEqual(parseCollectionInclude('todos,students,todos,__scalars__,bad-key'), ['todos', 'students']);
});

test('loading selected parts does not pull sibling collections', () => {
  const db = makeDb();
  writeWorkspaceDocument(db, 'acc-1', {
    students: [{ id: 1, name: 'keep-out' }],
    todos: [{ id: 10, title: 'needed' }],
    instructions: [{ id: 3, title: 'heavy' }],
    meta: { title: 'x' },
  }, { replaceAll: true });
  const parts = loadDocumentParts(db, 'acc-1', ['todos']);
  assert.equal(parts.data.todos[0].title, 'needed');
  assert.equal(parts.data.meta.title, 'x');
  assert.equal(parts.data.students, undefined);
  assert.equal(parts.data.instructions, undefined);
});
