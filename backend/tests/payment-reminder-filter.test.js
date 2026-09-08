const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const financeSource = fs.readFileSync(path.join(root, 'app-finance.js'), 'utf8');
const extraSource = fs.readFileSync(path.join(root, 'app-extra.js'), 'utf8');
const remindersRoute = fs.readFileSync(path.join(root, 'backend', 'routes', 'reminders.js'), 'utf8');
const { isPaymentReminder } = require('../utils/reminderKind');
const { computePushDueIndex } = require('../utils/pushDueIndex');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

const sandbox = vm.createContext({});
vm.runInContext(extractFunction(appSource, '_isPaymentReminder'), sandbox);
vm.runInContext(extractFunction(appSource, '_pendingPaymentReminderCount'), sandbox);

const sessionFollowup = {
  source: 'session_followup',
  title: 'اقدام جلسه: پیگیری بعد از جلسه — مونا ذکریایی',
  amount: 0,
  done: false,
};
const untitledSessionFollowup = {
  source: '',
  title: 'اقدام جلسه: پیگیری بعد از جلسه - مریم اصغریانیان',
  amount: 0,
  done: false,
};
const packageRenewal = {
  source: '',
  title: 'تجدید پکیج کوچینگ',
  amount: 19300000,
  done: false,
};

test('session followup rows are not payment reminders', () => {
  assert.equal(sandbox._isPaymentReminder(sessionFollowup), false);
  assert.equal(sandbox._isPaymentReminder(untitledSessionFollowup), false);
  assert.equal(sandbox._isPaymentReminder(packageRenewal), true);
  assert.equal(sandbox._pendingPaymentReminderCount([sessionFollowup, untitledSessionFollowup, packageRenewal]), 1);
  assert.equal(isPaymentReminder(sessionFollowup), sandbox._isPaymentReminder(sessionFollowup));
  assert.equal(isPaymentReminder(packageRenewal), sandbox._isPaymentReminder(packageRenewal));
});

test('financial reminder list and cash forecast skip session followups', () => {
  assert.match(financeSource, /const reminders = \(await window\.api\.reminders\.getAll\(\)\)\.filter\(_isPaymentReminder\)/);
  assert.match(financeSource, /updateReminderBadges\(_pendingPaymentReminderCount\(reminders\)\)/);
  assert.match(extraSource, /filter\(r=>!r\.done&&_isPaymentReminder\(r\)\)/);
  assert.match(remindersRoute, /!isPaymentReminder\(r\)/);
});

test('financial push index ignores session followup reminders', () => {
  const nowBeforeNine = new Date('2026-08-23T05:00:00.000Z');
  const onlyFollowup = computePushDueIndex('acc', {
    reminders: [{ id: 1, due_date_jalali: '1405/06/01', done: false, source: 'session_followup', title: 'اقدام جلسه: پیگیری بعد از جلسه' }],
  }, nowBeforeNine, new Set());
  assert.equal(onlyFollowup.nextDailyMs, null);

  const mixed = computePushDueIndex('acc', {
    reminders: [
      { id: 1, due_date_jalali: '1405/06/01', done: false, source: 'session_followup', title: 'اقدام جلسه: پیگیری بعد از جلسه' },
      { id: 2, due_date_jalali: '1405/06/01', done: false, title: 'تجدید پکیج کوچینگ', amount: 19300000 },
    ],
  }, nowBeforeNine, new Set());
  assert.ok(mixed.nextDailyMs);
});
