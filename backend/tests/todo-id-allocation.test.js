const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app.html'), 'utf8');

test('all todo generators use the single numeric allocator', () => {
  assert.equal((appSource.match(/_nextId\.todos\+\+/g) || []).length, 0);
  assert.equal((appSource.match(/_allocateTodoId\(\)/g) || []).length, 9); // declaration + eight call sites
  assert.match(appSource, /Date\.now\(\) \* 1000/);
  assert.match(appSource, /Number\.isSafeInteger/);
});

test('numeric ids and recurring parent relations remain unchanged', () => {
  assert.match(appSource, /const id = Math\.max\(_db\._todoIdHighWater \+ 1, timeCandidate\)/);
  assert.match(appSource, /recurrence_parent_id: _todoRootId\(t\)/);
  assert.match(appSource, /recurrence_parent_id: rootId/);
});
