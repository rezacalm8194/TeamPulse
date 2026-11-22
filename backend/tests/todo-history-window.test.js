// Clients get only recent todo history; storage must keep all of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  TODO_HISTORY_SEND_DAYS,
  mergeHistoryRows,
  trimTodoHistoryForClient,
  trimDocumentTodosForClient,
} = require('../utils/todoHistory');
const { upsertTodos, replaceTodos, loadAllTodos, loadTodosByIds } = require('../utils/todoStore');

function openDb() {
  try {
    const Database = require('better-sqlite3');
    return new Database(':memory:');
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.transaction = fn => (...args) => {
      db.exec('BEGIN');
      try { const r = fn(...args); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    };
    return db;
  }
}

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const iso = ms => new Date(ms).toISOString();
// A daily recurring todo completed every day for 300 days.
function dailyTodo(id = 1, days = 300) {
  const history = [];
  for (let d = days; d >= 1; d--) {
    history.push({ task_id: id, user_id: 'u1', action: 'completed', old_value: false, new_value: true, created_at: iso(NOW - d * DAY) });
  }
  return { id, title: 'ورزش', repeat: 'daily', updated_at: iso(NOW - DAY), history };
}

test('responses keep only the recent window (and at least the last 3 rows)', () => {
  const todo = dailyTodo();
  const sent = trimTodoHistoryForClient(todo, NOW);
  assert.equal(sent.history.length, TODO_HISTORY_SEND_DAYS);
  assert.equal(todo.history.length, 300, 'original object untouched');
  const old = { id: 2, history: [{ action: 'completed', created_at: iso(NOW - 400 * DAY) }, { action: 'completed', created_at: iso(NOW - 390 * DAY) }, { action: 'completed', created_at: iso(NOW - 380 * DAY) }, { action: 'completed', created_at: iso(NOW - 370 * DAY) }] };
  assert.equal(trimTodoHistoryForClient(old, NOW).history.length, 3);
  const doc = trimDocumentTodosForClient({ todos: [todo], students: [{ id: 1 }] }, NOW);
  assert.equal(doc.todos[0].history.length, TODO_HISTORY_SEND_DAYS);
  assert.deepEqual(doc.students, [{ id: 1 }]);
});

test('history merge is a union without duplicates', () => {
  const a = [{ action: 'completed', created_at: 't1', user_id: 'u', new_value: true }];
  const b = [{ action: 'completed', created_at: 't1', user_id: 'u', new_value: true }, { action: 'unchecked', created_at: 't2', user_id: 'u', new_value: false }];
  assert.deepEqual(mergeHistoryRows(a, b).map(r => r.created_at), ['t1', 't2']);
});

test('saving a todo with trimmed history never shrinks the stored history (upsert)', () => {
  const db = openDb();
  upsertTodos(db, 'ws', [dailyTodo()]);
  // Client received the trimmed copy, ticked today, and saves it back.
  const fromClient = trimTodoHistoryForClient(loadTodosByIds(db, 'ws', [1])[0], NOW);
  fromClient.history = [...fromClient.history, { task_id: 1, user_id: 'u1', action: 'completed', old_value: false, new_value: true, created_at: iso(NOW) }];
  fromClient.title = 'ورزش صبح';
  upsertTodos(db, 'ws', [fromClient]);
  const stored = loadTodosByIds(db, 'ws', [1])[0];
  assert.equal(stored.title, 'ورزش صبح', 'other fields still update');
  assert.equal(stored.history.length, 301, 'all 300 old rows kept + today');
  assert.equal(stored.history[0].created_at, iso(NOW - 300 * DAY));
  assert.equal(stored.history.at(-1).created_at, iso(NOW));
});

test('replacing the whole todo list keeps full history of surviving todos', () => {
  const db = openDb();
  replaceTodos(db, 'ws', [dailyTodo(1), dailyTodo(2, 10)]);
  const trimmed = loadAllTodos(db, 'ws').filter(t => t.id === 1).map(t => trimTodoHistoryForClient(t, NOW));
  replaceTodos(db, 'ws', trimmed); // todo 2 intentionally removed
  const all = loadAllTodos(db, 'ws');
  assert.deepEqual(all.map(t => t.id), [1]);
  assert.equal(all[0].history.length, 300);
});

test('a todo without stored history is saved as sent', () => {
  const db = openDb();
  upsertTodos(db, 'ws', [{ id: 9, title: 'x', history: [{ action: 'completed', created_at: iso(NOW) }] }]);
  assert.equal(loadTodosByIds(db, 'ws', [9])[0].history.length, 1);
});

test('client trims its local copy only after this session\'s server announced the window', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
  const grab = name => {
    const start = src.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unclosed ' + name);
  };
  const sandbox = { window: {}, Date, Number, Array };
  vm.createContext(sandbox);
  vm.runInContext(['_tpNoteTodoHistoryWindow', '_tpTodoHistoryWindowDays', '_trimLocalTodoHistory'].map(grab).join('\n'), sandbox);
  const now = Date.now();
  const make = () => ({ todos: [{ id: 1, history: Array.from({ length: 200 }, (_, i) => ({ action: 'completed', created_at: new Date(now - (200 - i) * DAY).toISOString() })) }] });
  const before = make();
  sandbox._trimLocalTodoHistory(before);
  assert.equal(before.todos[0].history.length, 200, 'no announcement → untouched');
  sandbox._tpNoteTodoHistoryWindow({ todo_history_days: 60 });
  const after = make();
  sandbox._trimLocalTodoHistory(after);
  assert.ok(after.todos[0].history.length >= 59 && after.todos[0].history.length <= 61);
  assert.match(src, /function _migrate\(d\) \{\s*d\.meta = [^\n]+\n\s*_trimLocalTodoHistory\(d\);/);
});
