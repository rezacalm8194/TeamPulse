const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const todos = fs.readFileSync(path.join(root, 'app-todos.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  let i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

const context = vm.createContext({});
vm.runInContext(extractFn(todos, '_todoSubtaskDeferTo'), context);
vm.runInContext(extractFn(todos, '_normalizeTodoSubtasks'), context);
vm.runInContext(extractFn(todos, '_todoSubtasks'), context);
vm.runInContext(extractFn(todos, '_todoSubtaskProgress'), context);
vm.runInContext(extractFn(todos, '_applyParentTickToSubtasks'), context);
vm.runInContext(extractFn(app, '_advanceRecurringTodoSubtasks'), context);

test('normalizes todo subtasks and drops empty rows', () => {
  const list = context._normalizeTodoSubtasks([
    { id: 1, text: '  پیام بده  ', done: true },
    { text: '' },
    'فایل را بفرست',
    { id: 1, text: 'تکراری شناسه', done: false },
  ]);
  assert.equal(list.length, 3);
  assert.equal(list[0].id, 1);
  assert.equal(list[0].text, 'پیام بده');
  assert.equal(list[0].done, true);
  assert.equal(list[1].text, 'فایل را بفرست');
  assert.equal(list[1].done, false);
  assert.equal(list[2].id, 4);
  assert.equal(context._todoSubtaskProgress({ subtasks: list }).done, 1);
  assert.equal(context._todoSubtaskProgress({ subtasks: list }).total, 3);
});

test('parent tick completes subtasks except those deferred to tomorrow', () => {
  const applied = context._applyParentTickToSubtasks([
    { id: 1, text: 'الف', done: false },
    { id: 2, text: 'ب', done: false, deferred: true },
    { id: 3, text: 'ج', done: true },
  ]);
  assert.equal(applied.leftover, 1);
  assert.equal(applied.next, 0);
  assert.equal(applied.subtasks[0].done, true);
  assert.equal(applied.subtasks[0].deferred, false);
  assert.equal(applied.subtasks[1].done, false);
  assert.equal(applied.subtasks[1].deferred, false);
  assert.equal(applied.subtasks[2].done, true);
  const all = context._applyParentTickToSubtasks([
    { id: 1, text: 'الف', done: false },
    { id: 2, text: 'ب', done: false },
  ]);
  assert.equal(all.leftover, 0);
  assert.equal(all.subtasks.every(item => item.done), true);
});

test('parent tick keeps next-cycle subtasks undone', () => {
  const applied = context._applyParentTickToSubtasks([
    { id: 1, text: 'الف', done: false },
    { id: 2, text: 'ب', done: false, defer_to: 'next' },
  ]);
  assert.equal(applied.leftover, 0);
  assert.equal(applied.next, 1);
  assert.equal(applied.subtasks[0].done, true);
  assert.equal(applied.subtasks[1].done, false);
  assert.equal(applied.subtasks[1].defer_to, 'next');
});

test('recurring parent does not revive completed one-shot subtasks', () => {
  const next = context._advanceRecurringTodoSubtasks([
    { id: 1, text: 'فعال‌سازی کیف پول', done: true },
    { id: 2, text: 'پیام بده', done: false },
    { id: 3, text: 'دور بعد', done: false, defer_to: 'next', deferred: true },
  ]);
  assert.equal(next.length, 2);
  assert.equal(next[0].id, 2);
  assert.equal(next[0].done, false);
  assert.equal(next[1].id, 3);
  assert.equal(next[1].done, false);
  assert.equal(next[1].defer_to, '');
  assert.equal(next[1].deferred, false);
  const afterParentTick = context._advanceRecurringTodoSubtasks(
    context._applyParentTickToSubtasks([
      { id: 1, text: 'الف', done: false },
      { id: 2, text: 'ب', done: false, defer_to: 'next' },
    ]).subtasks
  );
  assert.equal(afterParentTick.length, 1);
  assert.equal(afterParentTick[0].id, 2);
  assert.equal(afterParentTick[0].done, false);
});

test('prunes one-shot subtasks already done on a past snapshot', () => {
  const ctx = vm.createContext({
    _db: {
      todos: [
        {
          id: 1,
          date_jalali: '1404/08/08',
          subtasks: [
            { id: 1, text: 'کیف پول', done: false },
            { id: 2, text: 'پیام', done: false },
          ],
        },
        {
          id: 9,
          recurrence_parent_id: 1,
          _snapshot: true,
          date_jalali: '1404/08/07',
          subtasks: [
            { id: 1, text: 'کیف پول', done: true },
            { id: 2, text: 'پیام', done: false },
          ],
        },
      ],
    },
  });
  vm.runInContext('function _todoRootId(t){return t.recurrence_parent_id||t.id}', ctx);
  vm.runInContext('function _todoScheduledDate(t){return t.date_jalali||""}', ctx);
  vm.runInContext('function _jalaliKey(s){return String(s).replace(/\\//g,"")}', ctx);
  vm.runInContext(extractFn(app, '_pruneRevivedOneShotSubtasks'), ctx);
  assert.equal(ctx._pruneRevivedOneShotSubtasks(ctx._db.todos[0]), true);
  assert.equal(ctx._db.todos[0].subtasks.length, 1);
  assert.equal(ctx._db.todos[0].subtasks[0].id, 2);
});

test('caps subtasks at 40 items', () => {
  const list = context._normalizeTodoSubtasks(Array.from({ length: 50 }, (_, i) => ({ text: 'x' + i })));
  assert.equal(list.length, 40);
});

test('list, editor, and tick persist through todo delta', () => {
  assert.match(todos, /function _todoSubtasksBlockHtml\(/);
  assert.match(todos, /function _toggleTodoSubtask\(/);
  assert.match(todos, /_persistTodoSubtasks\(t\)/);
  assert.match(todos, /void _syncTodoDelta\(t, 'edit'\)/);
  assert.match(todos, /class="todo-subtasks"/);
  assert.match(todos, /function _addTodoSubtaskFromList\(/);
  assert.match(todos, /class="todo-subtask-tick"/);
  assert.match(todos, /todo-subtask-add-input/);
  assert.match(todos, /todo-subtask-add-btn/);
  assert.match(todos, /function _deferTodoSubtaskTomorrow\(/);
  assert.match(todos, /function _openTodoSubtaskDeferSheet\(/);
  assert.match(todos, /function _carryDeferredSubtasks\(/);
  assert.match(app, /'_openTodoSubtaskDeferSheet'/);
  assert.match(app, /function _advanceRecurringTodoSubtasks\(/);
  assert.match(app, /function _pruneRevivedOneShotSubtasks\(/);
  assert.match(app, /t\.subtasks = _advanceRecurringTodoSubtasks\(t\.subtasks\)/);
  assert.match(todos, /t\.subtasks = _advanceRecurringTodoSubtasks\(t\.subtasks\)/);
  assert.match(todos, /_pruneRevivedOneShotSubtasks\(t\)/);
  assert.doesNotMatch(todos, /function _revealTodoSubtaskAdd\(/);
  assert.match(todos, /ریزکارها/);
  assert.match(todos, /subtasks: _normalizeTodoSubtasks\(fields\.subtasks\)/);
  assert.match(todos, /const newTodo = _buildTodoRecord\(meta, \{ title, subtasks: _takeTodoSubtaskDraftForSave\(\) \}\)/);
  assert.match(todos, /subtasks: quickItems\.length === 1 \? subtasks : \[\]/);
  assert.match(todos, /function _takeTodoSubtaskDraftForSave\(/);
  assert.match(app, /_tpLazyFor\('app-todos\.js'/);
  assert.match(app, /'_toggleTodoSubtask'/);
  assert.match(app, /if \(Array\.isArray\(t\.subtasks\)\) \{/);
});
