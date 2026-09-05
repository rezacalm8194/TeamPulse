const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { applyTodoDeltaMerge } = require('../utils/todoMerge');

const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function device(todo) {
  const context = vm.createContext({
    _db: { todos: [structuredClone(todo)] },
    _isTodoRecurring: () => false,
    _mergeServerLoadedCollectionsIntoLocal: () => false,
    _localDeletedTodoIds: () => new Set(),
    _persistMergedServerDocument: () => {},
    _syncItemTime: item => Date.parse(item.updated_at || item.done_at || '') || 0,
  });
  vm.runInContext(['_cloneData', '_todoMergeTime', '_todoHasReopenAfter',
    '_todoRemoteDateRegressesLocal', '_pickMergedTodo', '_mergeServerTodosIntoLocal']
    .map(functionSource).join('\n'), context);
  return context;
}
const completed = {
  id: 1, done: true, archived: true, status: 'completed',
  done_at: '2026-09-05T08:00:00.000Z', updated_at: '2026-09-05T08:00:00.000Z',
};
const reopened = {
  ...completed, done: false, archived: false, status: 'pending', done_at: null,
  updated_at: '2026-09-05T09:00:00.000Z',
  history: [{ action: 'unchecked', created_at: '2026-09-05T09:00:00.000Z' }],
};

for (const origin of ['Android', 'desktop']) {
  test(`${origin} reopen survives stale response and reaches the other device`, () => {
    const sender = device(reopened);
    const receiver = device(completed);
    // An in-flight read can still contain the completion preceding the click.
    sender._mergeServerTodosIntoLocal({ todos: [completed] });
    assert.equal(sender._db.todos[0].done, false);
    assert.equal(sender._db.todos[0].archived, false);
    const saved = applyTodoDeltaMerge(sender._db.todos[0], completed, 'reopen');
    receiver._mergeServerTodosIntoLocal({ todos: [saved] });
    receiver._mergeServerTodosIntoLocal({ todos: [completed] });
    assert.equal(receiver._db.todos[0].done, false);
    assert.equal(receiver._db.todos[0].archived, false);
    assert.equal(receiver._db.todos[0].status, 'pending');
    assert.equal(receiver._db.todos[0].done_at, null);
  });
}

test('legacy completion still syncs without updated_at or history', () => {
  const client = device({ id: 1, done: false });
  client._mergeServerTodosIntoLocal({ todos: [{ id: 1, done: true, done_at: completed.done_at }] });
  assert.equal(client._db.todos[0].done, true);
});

test('a later completion wins over an earlier reopen', () => {
  const client = device(reopened);
  client._mergeServerTodosIntoLocal({ todos: [{ ...completed,
    done_at: '2026-09-05T10:00:00.000Z', updated_at: '2026-09-05T10:00:00.000Z' }] });
  assert.equal(client._db.todos[0].done, true);
});
