const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  todoHasStaffAssignee,
  todoShouldNotifyOwner,
  todoShouldNotifyTeamMember,
} = require('../utils/todoPushRecipients');

const grant = {
  email: 'hasti@example.test',
  staffId: '12',
  permissions: ['todolist', 'todo_view_assigned', 'todo_complete_own'],
};

test('assigned staff todos notify the linked member even if staff email differs', () => {
  const data = { staff: [{ id: 12, email: 'old-hasti@example.test' }] };
  const todo = { id: 1, title: 'چک‌لیست امروز', assignee_id: 12 };
  assert.equal(todoHasStaffAssignee(todo), true);
  assert.equal(todoShouldNotifyOwner(todo), false);
  assert.equal(todoShouldNotifyTeamMember(todo, data, grant), true);
});

test('owner personal todos notify the owner, not other staff', () => {
  const todo = { id: 2, title: 'کار خودم', date_jalali: '1405/06/23' };
  assert.equal(todoHasStaffAssignee(todo), false);
  assert.equal(todoShouldNotifyOwner(todo), true);
  assert.equal(todoShouldNotifyTeamMember(todo, { staff: [{ id: 12 }] }, grant), false);
});

test('a teammate is not notified for another staff member\'s task', () => {
  const todo = { id: 3, assignee_id: 99, assignee_email: 'other@example.test' };
  assert.equal(todoShouldNotifyTeamMember(todo, { staff: [{ id: 12 }, { id: 99 }] }, grant), false);
});

test('reminder cron uses grant staffId matching instead of staff-row email only', () => {
  const reminders = fs.readFileSync(path.join(__dirname, '../routes/reminders.js'), 'utf8');
  assert.match(reminders, /require\('\.\.\/utils\/todoPushRecipients'\)/);
  assert.match(reminders, /todoShouldNotifyOwner\(todo\)/);
  assert.match(reminders, /todoShouldNotifyTeamMember\(todo, userData, grant\)/);
  assert.match(reminders, /staff_id/);
  assert.doesNotMatch(reminders, /function ownStaffIdsForEmail\(/);
});
