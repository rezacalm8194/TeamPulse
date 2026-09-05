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

function pickMergedTodo(localItem, serverItem) {
  if (!localItem) return structuredClone(serverItem);
  if (!serverItem) return structuredClone(localItem);
  if (!!localItem.done !== !!serverItem.done) {
    const doneItem = localItem.done ? localItem : serverItem;
    const openItem = localItem.done ? serverItem : localItem;
    const doneAt = Date.parse(doneItem.done_at || doneItem.updated_at || '') || 0;
    const hasUncheck = (item) => (item.history || []).some(row =>
      row?.action === 'unchecked' && (Date.parse(row.created_at || '') || 0) >= doneAt);
    if (hasUncheck(openItem) || hasUncheck(doneItem)) return structuredClone(openItem);
    return structuredClone(doneItem);
  }
  const localTime = Date.parse(localItem.updated_at || localItem.done_at || '') || 0;
  const serverTime = Date.parse(serverItem.updated_at || serverItem.done_at || '') || 0;
  if (localTime === serverTime) return structuredClone(serverItem);
  return structuredClone(localTime > serverTime ? localItem : serverItem);
}

function resolveIncomingTodo(local, remote, { authoritative = false, pendingOp = '' } = {}) {
  if (!remote) return local ? structuredClone(local) : remote;
  if (!local) return structuredClone(remote);
  if (pendingOp === 'complete' || pendingOp === 'reopen' || pendingOp === 'edit' || pendingOp === 'create' || pendingOp === 'delete') {
    return structuredClone(local);
  }
  if (authoritative) return structuredClone(remote);
  return pickMergedTodo(local, remote);
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
