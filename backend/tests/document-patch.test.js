const test = require('node:test');
const assert = require('node:assert/strict');
const { applyDocumentPatch, candidateTodosFromPatch } = require('../utils/documentPatch');

test('document patch upserts and deletes only changed collection rows', () => {
  const previous = {
    students: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
    todos: [{ id: 10, title: 'old' }],
    meta: { appTitle: 'before' },
    _workspaceId: 'default',
  };
  const next = applyDocumentPatch(previous, {
    collections: {
      students: { upsert: [{ id: 2, name: 'B2' }], delete: [1] },
      todos: { upsert: [{ id: 11, title: 'new' }], delete: [] },
    },
    scalars: { meta: { appTitle: 'after' }, _workspaceId: 'hijack' },
  });
  assert.deepEqual(next.students, [{ id: 2, name: 'B2' }]);
  assert.equal(next.todos.length, 2);
  assert.equal(next.meta.appTitle, 'after');
  assert.equal(next._workspaceId, 'default');
});

test('todo candidate list from a delta keeps untouched rows', () => {
  const previous = { todos: [{ id: 1, title: 'keep' }, { id: 2, title: 'edit' }] };
  const todos = candidateTodosFromPatch(previous, {
    collections: { todos: { upsert: [{ id: 2, title: 'edited', done: true }], delete: [] } },
  });
  assert.equal(todos[0].title, 'keep');
  assert.equal(todos[1].title, 'edited');
});
