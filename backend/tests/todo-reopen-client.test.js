const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { applyTodoDeltaMerge } = require('../utils/todoMerge');

const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
assert.match(source, /function _resolveIncomingTodo\(/);
assert.match(source, /function _todoServerHydrateIsAuthoritative\(/);
assert.match(source, /if \(authoritative\) return _cloneData\(remote\)/);
assert.match(source, /if \(hydratedTodos\) _db\.todos = hydratedTodos/);

// Execute the shipped functions; copied merge implementations hid regressions.
const vm = require('node:vm');
function resolveIncomingTodo(local, remote, { authoritative = false, pendingOp = '' } = {}) {
  const context = vm.createContext({
    _readDurableTodoDeltaQueue: () => pendingOp ? [{ todoId: String(remote?.id ?? local?.id), operation: pendingOp }] : [],
    _isTodoRecurring: () => false,
  });
  const names = ['_cloneData', '_todoMergeTime', '_todoHasReopenAfter', '_pickMergedTodo',
    '_todoPendingDeltaOp', '_resolveIncomingTodo'];
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  return context._resolveIncomingTodo(local, remote, { authoritative });
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
    let sender = structuredClone(reopened);
    sender = resolveIncomingTodo(sender, completed);
    assert.equal(sender.done, false);
    const saved = applyTodoDeltaMerge(sender, completed, 'reopen');
    let receiver = structuredClone(completed);
    receiver = resolveIncomingTodo(receiver, saved);
    receiver = resolveIncomingTodo(receiver, completed);
    assert.equal(receiver.done, false);
    assert.equal(receiver.archived, false);
    assert.equal(receiver.status, 'pending');
    assert.equal(receiver.done_at, null);
  });
}

test('legacy completion still syncs without updated_at or history', () => {
  const merged = resolveIncomingTodo({ id: 1, done: false }, { id: 1, done: true, done_at: completed.done_at });
  assert.equal(merged.done, true);
});

test('a later completion wins over an earlier reopen', () => {
  const merged = resolveIncomingTodo(reopened, {
    ...completed,
    done_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:00.000Z',
  });
  assert.equal(merged.done, true);
});

test('Android hydrate takes a desktop reopen even without uncheck history', () => {
  const merged = resolveIncomingTodo(completed, {
    id: 1, done: false, archived: false, status: 'pending', done_at: null,
    updated_at: '2026-09-05T09:00:00.000Z',
  }, { authoritative: true });
  assert.equal(merged.done, false);
  assert.equal(merged.archived, false);
  assert.equal(merged.status, 'pending');
});

test('hydrate keeps a pending local complete over a server reopen', () => {
  const merged = resolveIncomingTodo(completed, {
    id: 1, done: false, status: 'pending', updated_at: '2026-09-05T09:00:00.000Z',
  }, { authoritative: true, pendingOp: 'complete' });
  assert.equal(merged.done, true);
});
