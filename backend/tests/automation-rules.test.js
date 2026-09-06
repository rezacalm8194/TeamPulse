const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');

function functionSource(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `${name} must exist`);
  const open = source.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(name);
}

function loadMany(names, context) {
  const sandbox = vm.createContext(context);
  for (const name of names) vm.runInContext(functionSource(name), sandbox);
  return sandbox;
}

test('session automation adds default due followup when none exist', () => {
  const db = { meta: { automation: { session_followup: true, session_followup_days: 3 } }, reminders: [] };
  const ctx = loadMany(
    ['_normalizeSessionFollowup', '_automationCfg', '_automationApplySessionFollowup'],
    {
      _db: db,
      _jalaliParse: str => String(str || '').split('/').map(Number),
      _todayJalali: () => [1405, 6, 10],
      _formatJalali: (y, m, d) => `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
      _addDays: (y, m, d, days) => [y, m, d + days],
    }
  );
  const session = { id: 1, student_id: 9, date_jalali: '1405/06/10', followups: [] };
  assert.equal(ctx._automationApplySessionFollowup(session), true);
  assert.equal(session.followups.length, 1);
  assert.equal(session.followups[0].text, 'پیگیری بعد از جلسه');
  assert.equal(session.followups[0].due_date_jalali, '1405/06/13');
});

test('session automation fills missing due dates only', () => {
  const db = { meta: { automation: { session_followup: true, session_followup_days: 2 } } };
  const ctx = loadMany(
    ['_normalizeSessionFollowup', '_automationCfg', '_automationApplySessionFollowup'],
    {
      _db: db,
      _jalaliParse: str => String(str || '').split('/').map(Number),
      _todayJalali: () => [1405, 1, 1],
      _formatJalali: (y, m, d) => `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
      _addDays: (y, m, d, days) => [y, m, d + days],
    }
  );
  const session = {
    date_jalali: '1405/01/01',
    followups: [
      { id: 1, text: 'بدون موعد', done: false, due_date_jalali: '' },
      { id: 2, text: 'با موعد', done: false, due_date_jalali: '1405/01/20' },
    ],
  };
  assert.equal(ctx._automationApplySessionFollowup(session), true);
  assert.equal(session.followups[0].due_date_jalali, '1405/01/03');
  assert.equal(session.followups[1].due_date_jalali, '1405/01/20');
});

test('stale lead automation creates one auto_stale_lead reminder', () => {
  let nextId = 1;
  const student = { id: 5, name: 'سارا', lname: 'احمدی', archived: true };
  const db = { meta: { automation: { stale_lead: true } }, students: [student], reminders: [] };
  const ctx = loadMany(
    ['_studentDisplayName', '_automationCfg', '_automationEnsureStaleLeadReminder'],
    {
      _db: db,
      isArchiveStale: () => true,
      _todayJalali: () => [1405, 6, 15],
      _formatJalali: (y, m, d) => `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
      _nextId: () => nextId++,
      Date,
    }
  );
  assert.equal(ctx._automationEnsureStaleLeadReminder(student), true);
  assert.equal(ctx._automationEnsureStaleLeadReminder(student), false);
  assert.equal(db.reminders.length, 1);
  assert.equal(db.reminders[0].source, 'auto_stale_lead');
  assert.match(db.reminders[0].title, /سارا/);
});

test('package due automation creates one todo per reminder inside window', () => {
  let nextId = 50;
  const reminder = {
    id: 7,
    student_id: 3,
    package_id: 11,
    title: 'سررسید پرداخت: کوچینگ',
    due_date_jalali: '1405/06/12',
    done: false,
  };
  const db = {
    meta: { automation: { package_due: true, package_due_days: 3 } },
    students: [{ id: 3, name: 'علی', lname: 'نوری' }],
    reminders: [reminder],
    todos: [],
  };
  const ctx = loadMany(
    ['_studentDisplayName', '_automationCfg', '_automationEnsurePackageDueTodo'],
    {
      _db: db,
      _daysUntil: () => 2,
      _todosInit: () => {},
      _allocateTodoId: () => nextId++,
      _todayJalali: () => [1405, 6, 10],
      _formatJalali: (y, m, d) => `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
      Date,
    }
  );
  assert.equal(ctx._automationEnsurePackageDueTodo(reminder), true);
  assert.equal(ctx._automationEnsurePackageDueTodo(reminder), false);
  assert.equal(db.todos.length, 1);
  assert.equal(db.todos[0].source, 'auto_package_due');
  assert.equal(db.todos[0].source_key, '7');
  assert.match(db.todos[0].title, /علی/);
});

test('convert automation creates onboarding checklist topic once', () => {
  let nextId = 1;
  const student = { id: 8, name: 'مینا', lname: 'رضایی', pinned_note: '' };
  const db = { meta: { automation: { convert_onboarding: true } }, topics: [] };
  const ctx = loadMany(
    ['_automationCfg', '_automationOnConvertToCustomer'],
    {
      _db: db,
      _todayJalali: () => [1405, 6, 1],
      _formatJalali: (y, m, d) => `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
      _nextId: () => nextId++,
      Date,
    }
  );
  assert.equal(ctx._automationOnConvertToCustomer(student), true);
  assert.equal(ctx._automationOnConvertToCustomer(student), false);
  assert.equal(db.topics.length, 1);
  assert.equal(db.topics[0].source, 'auto_onboarding');
  assert.equal(db.topics[0].checklist.length, 3);
  assert.match(student.pinned_note, /چک‌لیست/);
});

test('automation defaults and helpers exist in app.js', () => {
  assert.match(source, /const DEFAULT_AUTOMATION/);
  assert.match(source, /function _runAutomationScans/);
  assert.match(source, /function saveAutomationSettings/);
  assert.match(source, /source:'auto_stale_lead'/);
  assert.match(source, /source:'auto_package_due'/);
  assert.match(source, /source:'auto_onboarding'/);
});
