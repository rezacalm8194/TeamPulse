const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extraSource = fs.readFileSync(path.join(root, 'app-extra.js'), 'utf8');

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

test('staff reminder table treats due-month salary as paid, not overdue', () => {
  assert.match(appSource, /function _advanceStaffReminderPastPaidMonths\(/);
  assert.match(appSource, /function _reconcileStaffRemindersForPaidMonths\(/);
  assert.match(appSource, /staffReminders:\s*\{[\s\S]*?_reconcileStaffRemindersForPaidMonths\(\)/);
  assert.match(appSource, /paid_for_due_month:settlement\.paidForDueMonth/);
  assert.match(extraSource, /r\.paid_this_month \|\| r\.paid_for_due_month/);
  assert.doesNotMatch(extraSource, /else if \(r\.paid_this_month\) \{/);
});

test('paid Mehr salary rolls an overdue Mehr reminder into Aban', () => {
  const sandbox = {
    _db: {},
    saves: 0,
    _save() { sandbox.saves += 1; },
  };
  vm.createContext(sandbox);
  for (const name of [
    'div',
    'mod',
    'jalaliToGregorian',
    '_jalaliParse',
    '_jalaliKey',
    '_jalaliDaysInMonth',
    '_addMonths',
    '_formatJalali',
    '_staffMonthPaid',
    '_advanceStaffReminderPastPaidMonths',
    '_reconcileStaffRemindersForPaidMonths',
  ]) {
    vm.runInContext(extractFunction(appSource, name), sandbox);
  }

  const reminder = {
    id: 1,
    staff_id: 4,
    due_date_jalali: '۱۴۰۵/۰۷/۱۱',
    repeat_months: 1,
    done: false,
    notified_levels: ['overdue'],
  };
  sandbox._db = {
    staff_reminders: [reminder],
    staff_monthly: [{ id: 9, staff_id: 4, jy: 1405, jm: 7, paid: true }],
  };

  const changed = sandbox._reconcileStaffRemindersForPaidMonths();
  assert.equal(changed, true);
  assert.equal(sandbox.saves, 1);
  assert.equal(sandbox._jalaliKey(reminder.due_date_jalali), 14050811);
  assert.equal(reminder.done, false);
  assert.equal(reminder.notified_levels.length, 0);
  assert.equal(sandbox._reconcileStaffRemindersForPaidMonths(), false);

  reminder.due_date_jalali = '۱۴۰۵/۰۷/۱۱';
  sandbox._db.staff_monthly[0].paid = false;
  assert.equal(sandbox._advanceStaffReminderPastPaidMonths(reminder), false);
  assert.equal(sandbox._jalaliKey(reminder.due_date_jalali), 14050711);
});
