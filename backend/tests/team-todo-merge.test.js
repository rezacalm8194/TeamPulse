const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ownStaffIdsForGrant,
  todoAssignedToMember,
  mergeAllowedTeamTodos,
} = require('../utils/teamTodoMerge');

const grant = {
  email: 'hasti@example.test',
  staffId: '12',
  permissions: ['todo_view_assigned', 'todo_complete_own', 'todo_report_own'],
};

test('grant staffId counts as assigned even when staff row email differs', () => {
  const ids = ownStaffIdsForGrant({
    staff: [{ id: 12, email: 'old-hasti@example.test' }],
  }, grant);
  assert.equal(ids.has('12'), true);
  assert.equal(todoAssignedToMember({ id: 1, assignee_id: 12 }, grant.email, ids), true);
});

test('one-shot staff completion is kept for the owner', () => {
  const previous = {
    todos: [{ id: 1, title: 'منیجر فاطمه', assignee_id: 12, done: false, date_jalali: '1405/06/02' }],
    staff: [{ id: 12, email: 'other@example.test' }],
  };
  const next = mergeAllowedTeamTodos(previous, {
    todos: [{
      id: 1,
      title: 'منیجر فاطمه',
      assignee_id: 12,
      done: true,
      done_at: '2026-08-24T07:00:00.000Z',
      status: 'completed',
      updated_at: '2026-08-24T07:00:00.000Z',
    }],
  }, grant);
  const todo = next.todos.find(t => t.id === 1);
  assert.equal(todo.done, true);
  assert.equal(todo.status, 'completed');
});

test('recurring overdue tick stores snapshot and advances the template', () => {
  const previous = {
    todos: [{
      id: 2,
      title: 'ادمین اینستاگرام فاطمه',
      assignee_id: 12,
      repeat: 'daily',
      done: false,
      date_jalali: '1405/05/30',
      scheduled_date: '1405/05/30',
    }],
    staff: [{ id: 12 }],
  };
  const next = mergeAllowedTeamTodos(previous, {
    todos: [
      {
        id: 2,
        title: 'ادمین اینستاگرام فاطمه',
        assignee_id: 12,
        repeat: 'daily',
        done: false,
        date_jalali: '1405/06/02',
        scheduled_date: '1405/06/02',
        scheduledDate: '1405/06/02',
        updated_at: '2026-08-24T07:05:00.000Z',
        history: [{ action: 'completed', created_at: '2026-08-24T07:05:00.000Z' }],
      },
      {
        id: 99,
        title: 'ادمین اینستاگرام فاطمه',
        assignee_id: 12,
        recurrence_parent_id: 2,
        done: true,
        archived: true,
        _occurrence: true,
        date_jalali: '1405/05/30',
        scheduled_date: '1405/05/30',
      },
    ],
  }, grant);
  const template = next.todos.find(t => t.id === 2);
  const snapshot = next.todos.find(t => t.id === 99);
  assert.equal(template.date_jalali, '1405/06/02');
  assert.equal(template.done, false);
  assert.ok(snapshot);
  assert.equal(snapshot.done, true);
});
