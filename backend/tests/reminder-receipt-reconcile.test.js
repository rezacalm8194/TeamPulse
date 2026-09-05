const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

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

const sandbox = {
  _db: {},
  _enqueueDurableBusinessDelta() {},
  _save() {},
};
vm.createContext(sandbox);
for (const name of [
  'jalaliToGregorian',
  '_jalaliParse',
  '_jalaliKey',
  '_jalaliDaysInMonth',
  '_addMonths',
  '_formatJalali',
  '_nextFuturePaymentReminderDate',
  '_reminderDueKey',
  '_consumePaymentReminder',
  '_packagePaymentDueDate',
  '_isPackageChargeable',
  '_resolvePackageType',
  '_studentSummary',
  '_reconcileStudentPaymentReminders',
  '_reconcileOverdueRemindersForSettledCustomers',
]) {
  vm.runInContext(extractFunction(appSource, name), sandbox);
}
sandbox._todayJalali = () => [1405, 6, 15];

function shabnamWorkspace() {
  return {
    package_types: [{ id: 1, label: 'کوچینگ', color: '#888', key: 'coaching' }],
    staff: [],
    sessions: [],
    students: [{ id: 7, name: 'شبنم', lname: 'آصف', wallet: 0 }],
    packages: [{
      id: 42,
      student_id: 7,
      type_id: 1,
      total_amount: 7000000,
      initial_cost: 0,
      repeat_months: 2,
      payment_due_date: '۱۴۰۲/۰۹/۰۹',
    }],
    payments: [{
      id: 90,
      student_id: 7,
      package_id: null,
      amount: 7000000,
      currency: 'تومان',
      date_jalali: '۱۴۰۲/۰۸/۱۴',
      note: 'مانده قبلی',
    }],
    reminders: [{
      id: 3,
      student_id: 7,
      package_id: 42,
      title: 'تجدید پکیج: کوچینگ',
      due_date_jalali: '۱۴۰۲/۰۹/۰۹',
      repeat_months: 2,
      amount: 7000000,
      done: false,
      notified_levels: [],
    }],
  };
}

test('receipt save and reminder list keep settled customers off overdue reminders', () => {
  assert.match(appSource, /_enqueueDurableBusinessDelta\('payments', row, 'upsert'\); _reconcileStudentPaymentReminders\(p\.student_id, row\)/);
  assert.match(appSource, /_reconcileStudentPaymentReminders\(pay\.student_id, pay\)/);
  assert.match(appSource, /_reconcileOverdueRemindersForSettledCustomers\(\);/);
  assert.match(appSource, /Number\(student\.balance \|\| 0\) <= 0 && due && due <= today/);
});

test('settled previous-balance receipt consumes overdue package-renewal reminder', () => {
  sandbox._db = shabnamWorkspace();
  const reminder = sandbox._db.reminders[0];
  const changed = sandbox._reconcileStudentPaymentReminders(7, sandbox._db.payments[0]);
  assert.equal(changed, true);
  assert.equal(reminder.done, false);
  assert.ok(sandbox._jalaliKey(reminder.due_date_jalali) > sandbox._jalaliKey(sandbox._formatJalali(...sandbox._todayJalali())));
  assert.equal(sandbox._db.packages[0].payment_due_date, reminder.due_date_jalali);
});

test('opening reminders still repairs leftover overdue rows for settled customers', () => {
  sandbox._db = shabnamWorkspace();
  const reminder = sandbox._db.reminders[0];
  const changed = sandbox._reconcileOverdueRemindersForSettledCustomers();
  assert.equal(changed, true);
  assert.ok(sandbox._jalaliKey(reminder.due_date_jalali) > sandbox._jalaliKey('۱۴۰۵/۰۶/۱۵'));
});
