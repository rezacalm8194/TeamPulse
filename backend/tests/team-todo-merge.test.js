const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ownStaffIdsForGrant,
  todoAssignedToMember,
  mergeAllowedTeamTodos,
  mergeAllowedTeamDocument,
  allowedTeamDocumentPatch,
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

test('archive-permission team write keeps student upsert and owner-only rows', () => {
  const previous = {
    students: [
      { id: 1, name: 'OwnerRow', archived: true },
      { id: 2, name: 'OldName', archived: true, phone: '1' },
    ],
    todos: [],
    archive_categories: ['تولیدی'],
  };
  const grant = {
    email: 'mahdi@example.test',
    permissions: ['archive'],
  };
  const next = mergeAllowedTeamDocument(previous, {
    students: [
      { id: 2, name: 'NewName', archived: true, phone: '2' },
      { id: 3, name: 'MahdiAdded', archived: true },
    ],
    archive_categories: ['تولیدی', 'خدماتی'],
    _lastSaved: 123,
  }, grant);
  assert.equal(next.students.length, 3);
  assert.equal(next.students.find(s => s.id === 1).name, 'OwnerRow');
  assert.equal(next.students.find(s => s.id === 2).name, 'NewName');
  assert.equal(next.students.find(s => s.id === 3).name, 'MahdiAdded');
  assert.deepEqual(next.archive_categories, ['تولیدی', 'خدماتی']);
});

test('team without archive permission cannot persist student edits', () => {
  const previous = {
    students: [{ id: 1, name: 'Keep' }],
    todos: [],
  };
  const next = mergeAllowedTeamDocument(previous, {
    students: [{ id: 1, name: 'Hacked' }, { id: 2, name: 'New' }],
  }, { email: 'x@test', permissions: ['todolist', 'todo_complete_own'] });
  assert.equal(next.students.length, 1);
  assert.equal(next.students[0].name, 'Keep');
});

test('allowed team patch ignores wallet and team_members', () => {
  const patch = allowedTeamDocumentPatch({
    collections: {
      students: { upsert: [{ id: 9, name: 'A', archived: true }], delete: [] },
      team_members: { upsert: [{ id: 'x' }], delete: [] },
    },
    scalars: { wallet: 999, archive_categories: ['تولیدی'], _lastSaved: 1 },
  }, { email: 'mahdi@test', permissions: ['archive'] });
  assert.ok(patch.collections.students);
  assert.equal(patch.collections.team_members, undefined);
  assert.equal(patch.scalars.wallet, undefined);
  assert.deepEqual(patch.scalars.archive_categories, ['تولیدی']);
});

test('archive team delete removes tombstoned students without wiping others', () => {
  const previous = {
    students: [{ id: 1, name: 'Keep' }, { id: 2, name: 'Gone' }],
    todos: [],
  };
  const next = mergeAllowedTeamDocument(previous, {
    students: [{ id: 1, name: 'Keep' }],
    _deletedItems: { students: { 2: '2026-08-24T10:00:00.000Z' } },
  }, { email: 'mahdi@test', permissions: ['archive'] });
  assert.deepEqual(next.students.map(s => s.id), [1]);
});
