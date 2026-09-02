const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeAndApplyDeletedItems,
  stampPatchDeletesAsTombstones,
  looksLikeDestructiveOverwrite,
  looksLikeDestructiveCollectionOverwrite,
  patchLooksDestructive,
} = require('../utils/deletedItems');

test('keeps deleted staff out even when a stale client sends them back', () => {
  const previous = {
    staff: [{ id: 2, name: 'kept' }],
    staff_payments: [{ id: 20, staff_id: 2 }],
    _deletedItems: {
      staff: { '1': '2026-01-01T00:00:00.000Z' },
      staff_payments: { '10': '2026-01-01T00:00:00.000Z' },
    },
  };
  const next = mergeAndApplyDeletedItems(previous, {
    staff: [
      { id: 1, name: 'resurrected' },
      { id: 2, name: 'kept' },
    ],
    staff_payments: [
      { id: 10, staff_id: 1 },
      { id: 20, staff_id: 2 },
    ],
    _deletedItems: {},
  });
  assert.deepEqual(next.staff, [{ id: 2, name: 'kept' }]);
  assert.deepEqual(next.staff_payments, [{ id: 20, staff_id: 2 }]);
  assert.equal(next._deletedItems.staff['1'], '2026-01-01T00:00:00.000Z');
  assert.equal(next._deletedItems.staff_payments['10'], '2026-01-01T00:00:00.000Z');
});

test('delta staff deletes stay gone even if the client omitted _deletedItems', () => {
  const previous = {
    staff: [{ id: 1, name: 'gone' }, { id: 2, name: 'kept' }],
  };
  const patched = {
    staff: [{ id: 2, name: 'kept' }],
  };
  stampPatchDeletesAsTombstones(patched, {
    collections: { staff: { upsert: [], delete: [1] } },
  });
  const next = mergeAndApplyDeletedItems(previous, patched);
  assert.deepEqual(next.staff, [{ id: 2, name: 'kept' }]);
  assert.ok(next._deletedItems.staff['1']);
});

test('an unloaded empty staff part does not tombstone existing personnel', () => {
  const previous = {
    staff: [{ id: 1 }, { id: 2 }, { id: 3 }],
    staff_payments: [{ id: 10, staff_id: 1 }],
  };
  const next = mergeAndApplyDeletedItems(previous, {
    staff: [],
    staff_payments: [],
  });
  assert.equal(next.staff.length, 3);
  assert.equal(next.staff_payments.length, 1);
  assert.equal(Object.keys(next._deletedItems.staff || {}).length, 0);
});

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

test('owner save infers tombstones only for non-paginated collections', () => {
  const previous = {
    topics: [{ id: 8 }, { id: 9 }],
    packages: [{ id: 3, student_id: 8 }, { id: 4, student_id: 9 }],
  };
  const next = mergeAndApplyDeletedItems(previous, {
    topics: [{ id: 9 }],
    packages: [{ id: 4, student_id: 9 }],
  });
  assert.equal(next.topics.length, 1);
  assert.ok(next._deletedItems.topics['8']);
  assert.equal(next.packages.length, 2);
  assert.equal(Object.keys(next._deletedItems.packages || {}).length, 0);
});

test('explicit tombstones still remove paginated rows', () => {
  const previous = {
    packages: [{ id: 3 }, { id: 4 }],
  };
  const next = mergeAndApplyDeletedItems(previous, {
    packages: [{ id: 4 }],
    _deletedItems: { packages: { '3': '2026-01-01T00:00:00.000Z' } },
  });
  assert.deepEqual(next.packages, [{ id: 4 }]);
  assert.ok(next._deletedItems.packages['3']);
});

test('a first page of packages does not tombstone the rest of the sales ledger', () => {
  const previous = {
    packages: Array.from({ length: 250 }, (_, i) => ({ id: i + 1 })),
  };
  const next = mergeAndApplyDeletedItems(previous, {
    packages: Array.from({ length: 200 }, (_, i) => ({ id: i + 1 })),
  });
  assert.equal(next.packages.length, 250);
  assert.equal(Object.keys(next._deletedItems.packages || {}).length, 0);
});

test('restoring a backup resurrects rows that stale tombstones had hidden', () => {
  const previous = {
    packages: [{ id: 1 }, { id: 2 }],
    reminders: [{ id: 9 }],
    _deletedItems: {
      packages: { '1': '2026-08-01T00:00:00.000Z' },
      reminders: { '9': '2026-08-01T00:00:00.000Z' },
    },
  };
  const next = mergeAndApplyDeletedItems(previous, {
    packages: [{ id: 1, note: 'from backup' }, { id: 2 }],
    reminders: [{ id: 9, title: 'from backup' }],
    _deletedItems: {},
  }, { resurrectPresent: true });
  assert.equal(next.packages.length, 2);
  assert.equal(next.reminders.length, 1);
  assert.equal(next._deletedItems.packages?.['1'], undefined);
  assert.equal(next._deletedItems.reminders?.['9'], undefined);
});

test('omitted collections are not treated as a wipe of every row', () => {
  const previous = {
    students: [{ id: 1 }, { id: 2 }],
    packages: Array.from({ length: 40 }, (_, i) => ({ id: i + 1 })),
  };
  const next = mergeAndApplyDeletedItems(previous, {
    students: [{ id: 1 }, { id: 2 }],
  });
  assert.equal(Object.keys(next._deletedItems.packages || {}).length, 0);
});

test('a first page of a large collection does not infer mass tombstones', () => {
  const previous = {
    packages: Array.from({ length: 40 }, (_, i) => ({ id: i + 1 })),
  };
  const next = mergeAndApplyDeletedItems(previous, {
    packages: Array.from({ length: 8 }, (_, i) => ({ id: i + 1 })),
  });
  assert.equal(Object.keys(next._deletedItems.packages || {}).length, 0);
  assert.equal(next.packages.length, 40);
});

test('per-collection overwrite guard catches a truncated packages payload', () => {
  const previous = {
    packages: Array.from({ length: 40 }, (_, i) => ({ id: i + 1 })),
    payments: Array.from({ length: 40 }, (_, i) => ({ id: i + 1 })),
    todos: [{ id: 1 }],
  };
  const next = {
    packages: Array.from({ length: 8 }, (_, i) => ({ id: i + 1 })),
    payments: Array.from({ length: 40 }, (_, i) => ({ id: i + 1 })),
    todos: [{ id: 1 }],
  };
  assert.equal(looksLikeDestructiveOverwrite(previous, next), false);
  assert.equal(looksLikeDestructiveCollectionOverwrite(previous, next), true);
  assert.equal(patchLooksDestructive(previous, {
    collections: { packages: { upsert: [], delete: Array.from({ length: 30 }, (_, i) => i + 11) } },
  }), true);
});
