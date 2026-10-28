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
vm.runInContext(extractFn(todos, '_normalizeTodoSubtasks'), context);
vm.runInContext(extractFn(todos, '_todoSubtasks'), context);
vm.runInContext(extractFn(todos, '_todoSubtaskProgress'), context);
vm.runInContext(extractFn(todos, '_applyParentTickToSubtasks'), context);

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
  assert.match(todos, /function _deferTodoSubtaskTomorrow\(/);
  assert.match(todos, /_carryDeferredSubtasksToTomorrow\(t\)/);
  assert.match(app, /'_deferTodoSubtaskTomorrow'/);
  assert.doesNotMatch(todos, /function _revealTodoSubtaskAdd\(/);
  assert.match(todos, /ریزکارها/);
  assert.match(todos, /subtasks: _normalizeTodoSubtasks\(fields\.subtasks\)/);
  assert.match(todos, /const newTodo = _buildTodoRecord\(meta, \{ title, subtasks: window\._todoSubtaskDraft \}\)/);
  assert.match(app, /_tpLazyFor\('app-todos\.js'/);
  assert.match(app, /'_toggleTodoSubtask'/);
  assert.match(app, /if \(Array\.isArray\(t\.subtasks\)\) \{/);
  assert.match(app, /t\.subtasks = t\.subtasks\.map\(item => item && typeof item === 'object' \? \{ \.\.\.item, done: false, deferred: false \} : item\)/);
});
