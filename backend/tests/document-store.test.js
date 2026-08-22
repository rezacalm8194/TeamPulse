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
