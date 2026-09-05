const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  TODO_MIGRATION,
  ensureTodoStoreSchema,
  migrateTodosFromDocumentPart,
  loadAllTodos,
  loadTodosPage,
  countTodos,
  replaceTodos,
  upsertTodos,
  deleteTodos,
} = require('../utils/todoStore');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_data (
      account_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      data_etag TEXT
    );
    CREATE TABLE user_data_parts (
      account_id TEXT NOT NULL,
      part_key TEXT NOT NULL,
      data TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      PRIMARY KEY(account_id,part_key)
    );
  `);
  ensureTodoStoreSchema(db);
  return db;
}

test('migration moves JSON todo parts into rows and is idempotent', () => {
  const db = makeDb();
  db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)')
    .run('acc-migrate', '{"_layout":"parts"}');
  db.prepare('INSERT INTO user_data_parts(account_id,part_key,data,data_hash) VALUES (?,?,?,?)')
    .run('acc-migrate', 'todos', JSON.stringify([{ id: 1 }, { id: 2, archived: true }]), 'old');
  const first = migrateTodosFromDocumentPart(db);
  assert.deepEqual(first, { applied: true, workspaces: 1, todos: 2 });
  assert.equal(loadAllTodos(db, 'acc-migrate').length, 2);
  assert.equal(db.prepare(
    "SELECT 1 FROM user_data_parts WHERE account_id=? AND part_key='todos'"
  ).get('acc-migrate'), undefined);
  assert.ok(db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(TODO_MIGRATION));
  assert.deepEqual(migrateTodosFromDocumentPart(db), { applied: false, workspaces: 0, todos: 0 });
});

test('pagination cursor is stable and archived rows are separated', () => {
  const db = makeDb();
  replaceTodos(db, 'acc-page', [
    { id: 3, date_jalali: '1405/01/03', archived: false, updated_at: '2026-09-01T00:00:00.000Z' },
    { id: 1, date_jalali: '1405/01/01', archived: false, updated_at: '2026-09-03T00:00:00.000Z' },
    { id: 2, date_jalali: '1405/01/02', archived: false, updated_at: '2026-09-02T00:00:00.000Z' },
    { id: 4, date_jalali: '1405/01/04', archived: true, updated_at: '2026-09-04T00:00:00.000Z' },
  ]);
  const first = loadTodosPage(db, 'acc-page', { limit: 2, archived: 0 });
  assert.deepEqual(first.items.map(todo => todo.id), [1, 2]);
  assert.ok(first.next_cursor);
  const second = loadTodosPage(db, 'acc-page', { limit: 2, archived: 0, cursor: first.next_cursor });
  assert.deepEqual(second.items.map(todo => todo.id), [3]);
  assert.equal(second.next_cursor, null);
  assert.deepEqual(loadTodosPage(db, 'acc-page', { archived: 1 }).items.map(todo => todo.id), [4]);
  assert.equal(countTodos(db, 'acc-page', false), 3);
  assert.equal(countTodos(db, 'acc-page', true), 1);
});

test('recently updated todos are on the first page even with an older scheduled date', () => {
  const db = makeDb();
  replaceTodos(db, 'acc-recent', [
    ...Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      date_jalali: '1405/01/20',
      updated_at: '2026-09-01T00:00:00.000Z',
    })),
    { id: 99, date_jalali: '1404/01/01', updated_at: '2026-09-05T18:00:00.000Z' },
  ]);
  const first = loadTodosPage(db, 'acc-recent', { limit: 2, archived: 0 });
  assert.equal(first.items[0].id, 99);
});

test('page filtering keeps scanning until it fills a team-visible page', () => {
  const db = makeDb();
  replaceTodos(db, 'acc-team', Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    date_jalali: `1405/01/${String(i + 1).padStart(2, '0')}`,
    assignee: i % 3 === 0 ? 'member' : 'other',
    updated_at: `2026-09-01T00:00:${String(i + 1).padStart(2, '0')}.000Z`,
  })));
  const page = loadTodosPage(db, 'acc-team', {
    limit: 2,
    filter: todo => todo.assignee === 'member',
  });
  assert.deepEqual(page.items.map(todo => todo.id), [10, 7]);
  assert.ok(page.next_cursor);
});

test('Persian jalali dates get a real date_key so overdue pages sort by day', () => {
  const db = makeDb();
  replaceTodos(db, 'acc-fa', [
    { id: 2, date_jalali: '۱۴۰۴/۰۶/۱۲' },
    { id: 1, scheduled_date: '۱۴۰۴/۰۶/۱۰' },
  ]);
  const rows = db.prepare(
    'SELECT todo_id,date_key FROM workspace_todos WHERE storage_key=? ORDER BY date_key,todo_id'
  ).all('acc-fa');
  assert.deepEqual(rows.map(row => ({ id: row.todo_id, key: row.date_key })), [
    { id: '1', key: 14040610 },
    { id: '2', key: 14040612 },
  ]);
});

test('row upsert and delete change only addressed todos', () => {
  const db = makeDb();
  replaceTodos(db, 'acc-delta', [{ id: 1, done: false }, { id: 2, done: false }]);
  upsertTodos(db, 'acc-delta', [{ id: 1, done: true }]);
  deleteTodos(db, 'acc-delta', [2]);
  assert.deepEqual(loadAllTodos(db, 'acc-delta'), [{ id: 1, done: true }]);
});
