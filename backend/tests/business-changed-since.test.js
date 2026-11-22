const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureBusinessStoreSchema, upsertRows, replaceRows, loadChangedRows } = require('../utils/businessStore');

function makeDb() {
  const db = new Database(':memory:');
  ensureBusinessStoreSchema(db);
  return db;
}

test('changed_since returns only rows written after the given server time', async () => {
  const db = makeDb();
  replaceRows(db, 'w1', 'students', [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
  const first = loadChangedRows(db, 'w1', 'students', { since: 0 });
  assert.equal(first.items.length, 2);
  const mark = Date.now();
  await new Promise(r => setTimeout(r, 5));
  upsertRows(db, 'w1', 'students', [{ id: 2, name: 'b2', updated_at: new Date().toISOString() }, { id: 3, name: 'c' }]);
  const delta = loadChangedRows(db, 'w1', 'students', { since: mark });
  assert.deepEqual(delta.items.map(r => r.id).sort(), [2, 3]);
  assert.equal(delta.items.find(r => r.id === 2).name, 'b2');
  assert.equal(delta.next_cursor, null);
});

test('changed_since pages with a cursor and never repeats rows', () => {
  const db = makeDb();
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: 'n' + i }));
  replaceRows(db, 'w1', 'payments', rows);
  const seen = [];
  let cursor = null;
  do {
    const page = loadChangedRows(db, 'w1', 'payments', { since: 0, limit: 10, cursor });
    page.items.forEach(r => seen.push(r.id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(seen.length, 25);
  assert.equal(new Set(seen).size, 25);
});

test('rows that predate the change clock are not reported as changes', () => {
  const db = makeDb();
  replaceRows(db, 'w1', 'sessions', [{ id: 1 }]);
  db.prepare('UPDATE workspace_business_rows SET changed_at=0').run();
  assert.equal(loadChangedRows(db, 'w1', 'sessions', { since: 0 }).items.length, 0);
});

test('schema upgrade adds changed_at to an existing table', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE workspace_business_rows (
    storage_key TEXT NOT NULL, collection_key TEXT NOT NULL, row_id TEXT NOT NULL,
    payload TEXT NOT NULL, payload_hash TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    date_key INTEGER NOT NULL DEFAULT 0, search_text TEXT NOT NULL DEFAULT '', updated_at TEXT,
    PRIMARY KEY(storage_key,collection_key,row_id));`);
  db.prepare("INSERT INTO workspace_business_rows(storage_key,collection_key,row_id,payload,payload_hash) VALUES ('w1','students','1','{\"id\":1}','x')").run();
  ensureBusinessStoreSchema(db);
  const cols = db.prepare('PRAGMA table_info(workspace_business_rows)').all().map(c => c.name);
  assert.ok(cols.includes('changed_at'));
  upsertRows(db, 'w1', 'students', [{ id: 1, name: 'new', updated_at: new Date().toISOString() }]);
  assert.equal(loadChangedRows(db, 'w1', 'students', { since: 0 }).items[0].name, 'new');
});
