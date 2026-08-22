const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeAndApplyDeletedItems } = require('../utils/deletedItems');

test('keeps deleted students out even when a stale client sends them back', () => {
  const previous = {
    students: [{ id: 2, name: 'kept' }],
    _deletedItems: { students: { '1': '2026-01-01T00:00:00.000Z' } },
  };
  const next = mergeAndApplyDeletedItems(previous, {
    students: [
      { id: 1, name: 'resurrected' },
      { id: 2, name: 'kept' },
    ],
    _deletedItems: {},
  });
  assert.deepEqual(next.students, [{ id: 2, name: 'kept' }]);
  assert.equal(next._deletedItems.students['1'], '2026-01-01T00:00:00.000Z');
});

test('owner save infers tombstones for students removed from the document', () => {
  const previous = {
    students: [{ id: 8, name: 'gone' }, { id: 9, name: 'stay' }],
    packages: [{ id: 3, student_id: 8 }],
  };
  const next = mergeAndApplyDeletedItems(previous, {
    students: [{ id: 9, name: 'stay' }],
    packages: [],
  });
  assert.equal(next.students.length, 1);
  assert.ok(next._deletedItems.students['8']);
  assert.ok(next._deletedItems.packages['3']);
});
