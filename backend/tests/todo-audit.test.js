const test = require('node:test');
const assert = require('node:assert/strict');
const { diffTodos, emitTodoAudit } = require('../utils/todoAudit');

const baseTodo = {
  id: 101,
  title: 'private title',
  note: 'private note',
  manager_note: 'private manager note',
  staff_report: 'private report',
  done: false,
  status: 'pending',
  assignee_id: 12,
  priority: 'medium',
  scheduled_date: '1405/05/27',
};

function events(previous, next) {
  return diffTodos(previous, next).map(change => change.event);
}

test('todo creation emits only todo_created', () => {
  assert.deepEqual(events([], [baseTodo]), ['todo_created']);
});

test('checking a todo emits only todo_completed', () => {
  const next = { ...baseTodo, done: true, status: 'completed', done_at: '2026-08-18T01:00:00Z' };
  assert.deepEqual(events([baseTodo], [next]), ['todo_completed']);
});

test('unchecking a todo emits only todo_reopened', () => {
  const previous = { ...baseTodo, done: true, status: 'completed' };
  assert.deepEqual(events([previous], [baseTodo]), ['todo_reopened']);
});

test('editing an important field emits todo_updated with field names only', () => {
  const next = { ...baseTodo, title: 'new private title', priority: 'high' };
  const [change] = diffTodos([baseTodo], [next]);
  assert.equal(change.event, 'todo_updated');
  assert.deepEqual(change.metadata.changedFields, ['title', 'priority']);
  assert.equal(JSON.stringify(change).includes('private title'), false);
  assert.equal(JSON.stringify(change).includes('new private title'), false);
});

test('changing assignee emits todo_assigned without duplicate todo_updated', () => {
  const next = { ...baseTodo, assignee_id: 48 };
  const [change] = diffTodos([baseTodo], [next]);
  assert.equal(change.event, 'todo_assigned');
  assert.equal(change.metadata.previousTargetUserId, '12');
  assert.equal(change.metadata.nextTargetUserId, '48');
});

test('deletion emits only todo_deleted', () => {
  assert.deepEqual(events([baseTodo], []), ['todo_deleted']);
});

test('unchanged todos emit no audit changes', () => {
  assert.deepEqual(diffTodos([baseTodo], [{ ...baseTodo }]), []);
});

test('completion and another edit emit completion plus non-duplicate update fields', () => {
  const next = { ...baseTodo, done: true, status: 'completed', priority: 'urgent' };
  const changes = diffTodos([baseTodo], [next]);
  assert.deepEqual(changes.map(change => change.event), ['todo_completed', 'todo_updated']);
  assert.deepEqual(changes[1].metadata.changedFields, ['priority']);
});

test('actual assignee aliases are normalized without email fallback', () => {
  const previous = { ...baseTodo, assignee_id: undefined, staff_id: 12, assignee_email: 'private@example.test' };
  const next = { ...previous, staff_id: undefined, assigneeId: 48 };
  const [change] = diffTodos([previous], [next]);
  assert.equal(change.event, 'todo_assigned');
  assert.equal(JSON.stringify(change).includes('private@example.test'), false);
});

test('audit emission never throws into the sync path', () => {
  const logger = {
    audit() { throw Object.assign(new Error('disk unavailable'), { code: 'EACCES' }); },
    error() { throw new Error('stderr unavailable'); },
  };
  assert.doesNotThrow(() => emitTodoAudit(logger, { requestId: 'r1', user: { id: 'u1' } }, diffTodos([], [baseTodo])));
});

test('recurring completion snapshot uses occurrence identity and safe metadata', () => {
  const snapshot = {
    ...baseTodo, id: 502, recurrence_parent_id: 101,
    scheduled_date: '1405/05/28',
    _snapshot: true, archived: true, done: true, status: 'late_completed',
  };
  const [change] = diffTodos([baseTodo], [baseTodo, snapshot]);
  assert.equal(change.event, 'todo_completed');
  assert.equal(change.entityId, '502');
  assert.equal(change.recurringSnapshot, true);
  assert.deepEqual(change.metadata, { rootTodoId: '101', occurrence: '1405/05/28' });
});

test('two recurring occurrences of one root are distinguishable', () => {
  const snapshots = [1001, 1002].map((id, index) => ({
    id, recurrence_parent_id: 101, scheduled_date: `1405/05/${28 + index}`,
    _snapshot: true, archived: true, done: true, status: 'completed',
  }));
  const changes = diffTodos([], snapshots);
  assert.deepEqual(changes.map(change => change.entityId), ['1001', '1002']);
  assert.deepEqual(changes.map(change => change.metadata.rootTodoId), ['101', '101']);
});

test('audit payload contains no todo text or sensitive request data', () => {
  const written = [];
  const logger = { audit: (event, fields) => written.push({ event, ...fields }), error() {} };
  const req = {
    requestId: 'safe-request-id', user: { id: 'actor-1' },
    headers: { authorization: 'Bearer secret', cookie: 'session=secret' },
    body: { token: 'secret', data: { todos: [baseTodo] } },
  };
  emitTodoAudit(logger, req, diffTodos([], [baseTodo]));
  const serialized = JSON.stringify(written);
  for (const forbidden of ['private title', 'private note', 'private manager note', 'private report', 'Bearer secret', 'session=secret']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
