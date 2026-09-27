const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const todos = fs.readFileSync(path.join(root, 'app-todos.js'), 'utf8');

function fn(source, name) {
  const match = new RegExp(`(?:async\\s+)?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  let depth = 0;
  for (let i = source.indexOf('{', match.index); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw Error(name);
}

function load() {
  const context = vm.createContext({
    Date,
    _db: { todos: [] },
    _todoDurationMinutes(t) {
      const raw = typeof t === 'object' && t ? t.duration_min : t;
      const n = parseInt(raw || '0', 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    },
    _todoScheduledDate(t) {
      return t?.scheduled_date || t?.scheduledDate || t?.date_jalali || '';
    },
  });
  for (const name of [
    'div',
    'mod',
    'enDigits',
    'jalaliToGregorian',
    'gregorianToJalali',
    '_jalaliParse',
    '_jalaliKey',
    '_formatJalali',
    '_addDays',
  ]) {
    vm.runInContext(fn(app, name), context);
  }
  const start = todos.indexOf('const _QUICK_TODO_NEAR_MIN');
  const end = todos.indexOf('function openAddTodo(');
  assert.ok(start >= 0 && end > start, 'quick todo parser block');
  vm.runInContext(todos.slice(start, end), context);
  return context;
}

const TODAY = '۱۴۰۵/۰۷/۰۵';

test('quick todo parser reads date, time and duration from each line', () => {
  const ctx = load();
  const items = ctx._parseQuickTodos(
    'فردا ۱۰ صبح تماس با فاطمه ۳۰ دقیقه\nامروز ۱۶ جلسه با مهدی ۱ ساعت',
    { todayJalali: TODAY, durationMin: 30, category: 'personal' }
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'تماس با فاطمه');
  assert.equal(ctx._jalaliKey(items[0].dateJalali), ctx._jalaliKey('۱۴۰۵/۰۷/۰۶'));
  assert.equal(items[0].time, '10:00');
  assert.equal(items[0].durationMin, 30);
  assert.equal(items[0].category, 'clients');
  assert.equal(items[1].title, 'جلسه با مهدی');
  assert.equal(ctx._jalaliKey(items[1].dateJalali), ctx._jalaliKey(TODAY));
  assert.equal(items[1].time, '16:00');
  assert.equal(items[1].durationMin, 60);
});

test('quick todo parser splits one spoken line with two dates', () => {
  const ctx = load();
  const items = ctx._parseQuickTodos(
    'فردا ۱۰ صبح تماس با علی ۳۰ دقیقه امروز ۱۶ جلسه با مهدی ۱ ساعت',
    { todayJalali: TODAY }
  );
  assert.equal(items.length, 2);
  assert.match(items[0].title, /تماس با علی/);
  assert.match(items[1].title, /جلسه با مهدی/);
});

test('quick todo parser keeps customer names that contain یک', () => {
  const ctx = load();
  const items = ctx._parseQuickTodos('امروز ۱۰ صبح تماس با یکی از مشتریان', { todayJalali: TODAY });
  assert.equal(items.length, 1);
  assert.match(items[0].title, /یکی از مشتریان/);
});

test('schedule conflict helper flags overlap and nearby gaps', () => {
  const ctx = load();
  const a = { title: 'جلسه طلوع', dateJalali: TODAY, time: '10:30', durationMin: 60 };
  const b = { title: 'تماس', dateJalali: TODAY, time: '11:00', durationMin: 30 };
  const c = { title: 'نزدیک', dateJalali: TODAY, time: '11:40', durationMin: 30 };
  const overlap = ctx._quickTodoConflictAgainst(a, b, 15);
  const near = ctx._quickTodoConflictAgainst(b, c, 15);
  assert.equal(overlap.kind, 'overlap');
  assert.equal(near.kind, 'near');
  assert.equal(near.gap, 10);
});

test('quick todo parser understands weekday next week and add-command filler', () => {
  const ctx = load();
  const items = ctx._parseQuickTodos(
    'چهارشنبه هفته آینده جلسه با علی " رو اضافه کن',
    { todayJalali: TODAY }
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'جلسه با علی');
  assert.equal(ctx._jalaliKey(items[0].dateJalali), ctx._jalaliKey('۱۴۰۵/۰۷/۱۵'));
  const flipped = ctx._parseQuickTodos('هفته آینده چهارشنبه جلسه با علی', { todayJalali: TODAY });
  assert.equal(ctx._jalaliKey(flipped[0].dateJalali), ctx._jalaliKey('۱۴۰۵/۰۷/۱۵'));
  const thisWeek = ctx._parseQuickTodos('چهارشنبه جلسه با علی', { todayJalali: TODAY });
  assert.equal(ctx._jalaliKey(thisWeek[0].dateJalali), ctx._jalaliKey('۱۴۰۵/۰۷/۰۸'));
});

test('add-todo modal has quick capture box and save uses parser', () => {
  assert.match(todos, /id="todo-quick"/);
  assert.match(todos, /function _toggleQuickTodoExtra\(/);
  assert.match(todos, /_collectQuickTodosForSave/);
  assert.match(fn(todos, 'saveTodo'), /_collectQuickTodosForSave/);
  assert.match(fn(todos, 'saveTodo'), /todo-quick/);
});
