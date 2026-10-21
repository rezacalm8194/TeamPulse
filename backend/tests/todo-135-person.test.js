const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const todos = fs.readFileSync(path.join(__dirname, '..', '..', 'app-todos.js'), 'utf8');

function personKey(t) {
  const id = String(t?.assignee_id || t?.staff_id || '').trim();
  if (id) return 'staff:' + id;
  const email = String(t?.assignee_email || '').trim().toLowerCase();
  if (email) return 'email:' + email;
  return 'owner';
}

function clearConflicts(list, rank, exceptId, personKeyArg) {
  const extras = [];
  const except = list.find(t => String(t.id) === String(exceptId));
  const key = personKeyArg || personKey(except || {});
  list.forEach(t => {
    if (String(t.id) === String(exceptId)) return;
    if (t.archived) return;
    if (personKey(t) !== key) return;
    if ((parseInt(t.main_today_rank || '0', 10) || 0) !== rank) return;
    t.main_today_rank = 0;
    extras.push(t);
  });
  return extras;
}

test('1-3-5 ranks are scoped per assignee, not globally', () => {
  const owner = { id: 1, main_today_rank: 1 };
  const staffA = { id: 2, assignee_id: 10, main_today_rank: 1 };
  const staffB = { id: 3, assignee_id: 11, main_today_rank: 1 };
  const staffADup = { id: 4, assignee_id: 10, main_today_rank: 1 };
  const list = [owner, staffA, staffB, staffADup];
  const extras = clearConflicts(list, 1, 4, personKey(staffADup));
  assert.equal(staffA.main_today_rank, 0);
  assert.equal(staffADup.main_today_rank, 1);
  assert.equal(owner.main_today_rank, 1);
  assert.equal(staffB.main_today_rank, 1);
  assert.equal(extras.length, 1);
  assert.equal(personKey(owner), 'owner');
  assert.equal(personKey(staffA), 'staff:10');
});

test('staff 1-3-5 board is rendered on the personnel tab', () => {
  assert.match(todos, /function _todoStaff135SectionHtml\(/);
  assert.match(todos, /const staff135Html = _todoStaff135SectionHtml\(\)/);
  assert.match(todos, /titleSuffix: isGuestList \? 'شما' : ''/);
  assert.match(todos, /_todo135TodosForPerson\(_todo135PersonKeyFromStaffId\(guestStaff\.id\)\)/);
  assert.match(todos, /onclick="_openTodo135Picker\(\$\{rank\}\$\{pickerArg\}\)"/);
});

test('linked staff HTML shows the manager-assigned 1-3-5 task for that person only', () => {
  const start = todos.indexOf('const _TODO_135_SLOTS = [');
  const end = todos.indexOf('function _todo135PickRowHtml');
  assert.ok(start > 0 && end > start);
  const vm = require('node:vm');
  const today = '1405/07/29';
  const todayKey = 14050729;
  const context = {
    _db: {
      staff: [{ id: 10, name: 'علی', lname: 'رضایی', person_type: 'personnel' }],
      todos: [
        { id: 1, title: 'کار شخصی مدیر', main_today_rank: 1, date_jalali: today },
        { id: 2, title: 'پیگیری مشتری ویژه', assignee_id: 10, main_today_rank: 1, date_jalali: today, done: false },
        { id: 3, title: 'کار پرسنل دیگر', assignee_id: 11, main_today_rank: 1, date_jalali: today },
      ],
    },
    _todoStaffFilter: { staffId: '10' },
    escapeHtml: s => String(s || ''),
    fa: n => String(n),
    staffIsPersonnel: s => (s?.person_type || 'personnel') === 'personnel',
    _todoStaffName: s => `${s.name} ${s.lname}`.trim(),
    _todoCanEdit: () => false,
    _todoCanCreateForStaff: () => false,
    _todoCanView: t => String(t.assignee_id || '') === '10' || !t.assignee_id,
    _todoScheduledDate: t => t.date_jalali || '',
    _jalaliKey: s => Number(String(s).replace(/\D/g, '')),
    _jalaliToday: () => todayKey,
    _isTeamGuest: () => true,
    _todoSessionStaff: () => ({ id: 10, name: 'علی' }),
  };
  vm.createContext(context);
  vm.runInContext(todos.slice(start, end), context);
  const managerBoard = context._todoStaff135SectionHtml();
  assert.match(managerBoard, /پیگیری مشتری ویژه/);
  assert.match(managerBoard, /قانون ۱-۳-۵ · علی رضایی/);
  assert.doesNotMatch(managerBoard, /کار شخصی مدیر/);
  assert.doesNotMatch(managerBoard, /کار پرسنل دیگر/);
  context._todoCanView = t => String(t.assignee_id || '') === '10';
  const guestTodos = context._todo135TodosForPerson('staff:10');
  const guestBoard = context._todo135BoardHtml(guestTodos, { titleSuffix: 'شما', canAssign: false });
  assert.match(guestBoard, /پیگیری مشتری ویژه/);
  assert.match(guestBoard, /قانون ۱-۳-۵ · شما/);
  assert.doesNotMatch(guestBoard, /کار شخصی مدیر/);
});
