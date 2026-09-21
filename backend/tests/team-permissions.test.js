const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pickResolvedTeamPermissions,
  TODO_DEFAULT_STAFF_PERMISSIONS,
} = require('../utils/teamPermissions');

test('owner document permissions win over an empty compact-link grant', () => {
  const perms = pickResolvedTeamPermissions(
    ['todolist', 'todo_view_assigned', 'todo_complete_own'],
    '[]',
    'staff_basic'
  );
  assert.deepEqual(perms, ['todolist', 'todo_view_assigned', 'todo_complete_own']);
});

test('staff_basic with empty document and grant still gets default todo access', () => {
  const perms = pickResolvedTeamPermissions([], [], 'staff_basic');
  assert.ok(perms.includes('todolist'));
  assert.ok(perms.includes('todo_complete_own'));
  assert.deepEqual(perms.slice(0, TODO_DEFAULT_STAFF_PERMISSIONS.length), TODO_DEFAULT_STAFF_PERMISSIONS);
});

test('custom role with empty lists stays empty', () => {
  assert.deepEqual(pickResolvedTeamPermissions([], [], 'custom'), []);
});
