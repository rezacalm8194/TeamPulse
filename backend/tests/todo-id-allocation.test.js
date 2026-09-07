const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const todosSource = fs.readFileSync(path.join(root, 'app-todos.js'), 'utf8');

test('all todo generators use the single numeric allocator', () => {
  const client = appSource + todosSource;
  assert.equal((client.match(/_nextId\.todos\+\+/g) || []).length, 0);
  assert.equal((client.match(/_allocateTodoId\(\)/g) || []).length, 14);
  assert.match(appSource, /function _allocateTodoId\(/);
  assert.match(appSource, /Date\.now\(\) \* 1000/);
  assert.match(appSource, /Number\.isSafeInteger/);
});

test('numeric ids and recurring parent relations remain unchanged', () => {
  assert.match(appSource, /const id = Math\.max\(_db\._todoIdHighWater \+ 1, timeCandidate\)/);
  assert.match(appSource, /recurrence_parent_id: _todoRootId\(t\)/);
  assert.match(todosSource, /recurrence_parent_id: rootId/);
});
