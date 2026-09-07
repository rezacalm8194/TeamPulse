const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
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

const sandbox = {
  JMONTHS: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
  _db: {},
};
vm.createContext(sandbox);
sandbox._jalaliParse = str => {
  const norm = String(str || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^\d]/g, '/').replace(/\/+/g, '/');
  return norm.split('/').map(x => parseInt(x, 10));
};
sandbox._jalaliKey = str => {
  const p = sandbox._jalaliParse(str);
  if (p.length !== 3 || p.some(Number.isNaN)) return 0;
  return p[0] * 10000 + p[1] * 100 + p[2];
};
sandbox._todayJalali = () => [1405, 6, 16];
sandbox._formatJalali = (jy, jm, jd) => `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
sandbox._addMonths = (jy, jm, jd, months) => {
  let tot = (jy * 12 + (jm - 1)) + months;
  return [Math.floor(tot / 12), (tot % 12) + 1, jd];
};
sandbox._nextId = t => {
  sandbox._db._nextId = sandbox._db._nextId || {};
  const id = sandbox._db._nextId[t] || 1;
  sandbox._db._nextId[t] = id + 1;
  return id;
};
sandbox._daysUntil = () => 2;

for (const name of [
  '_toEnDigits',
  '_staffSalaryNote',
  '_staffExpectedMonthly',
  '_staffPaymentSalaryMonth',
  '_staffMonthAdjTotal',
  '_staffPaidTowardMonth',
  '_staffRemainingForMonth',
  '_advanceStaffReminderIfMonthSettled',
  '_reconcileStaffSalaryMonth',
  '_staffSummary',
]) {
  vm.runInContext(extractFunction(appSource, name), sandbox);
}

function resetDb() {
  sandbox._db = {
    staff: [{ id: 1, name: 'مهدی', lname: 'صفری', salary: 20000000, roles: [] }],
    staff_roles: [],
    staff_payments: [],
    staff_adjustments: [],
    staff_monthly: [],
    staff_reminders: [{ id: 9, staff_id: 1, due_date_jalali: '1405/06/18', done: false, repeat_months: 1, notified_levels: [] }],
    _nextId: { staff_monthly: 1 },
  };
}

test('advance free payment of 5 from 20 reduces remaining salary this month', () => {
  resetDb();
  sandbox._db.staff_payments.push({
    id: 10,
    staff_id: 1,
    amount: 5000000,
    date_jalali: '1405/06/16',
    note: '',
  });
  const summary = sandbox._staffSummary(sandbox._db.staff[0]);
  assert.equal(summary.expectedMonthly, 20000000);
  assert.equal(summary.paid_toward_this_month, 5000000);
  assert.equal(summary.remaining_this_month, 15000000);
  assert.equal(summary.paid_this_month, false);
});

test('salary note from a previous month does not reduce the current remaining', () => {
  resetDb();
  sandbox._db.staff_payments.push({
    id: 11,
    staff_id: 1,
    amount: 20000000,
    date_jalali: '1405/05/14',
    note: 'حقوق مرداد ۱۴۰۵',
  });
  sandbox._db.staff_payments.push({
    id: 12,
    staff_id: 1,
    amount: 5000000,
    date_jalali: '1405/06/16',
    note: '',
  });
  const summary = sandbox._staffSummary(sandbox._db.staff[0]);
  assert.equal(summary.remaining_this_month, 15000000);
  assert.equal(sandbox._staffPaymentSalaryMonth(sandbox._db.staff_payments[0]).join('/'), '1405/5');
});

test('explicit for_jy/for_jm wins over payment date', () => {
  resetDb();
  const month = sandbox._staffPaymentSalaryMonth({
    amount: 5000000,
    date_jalali: '1405/05/20',
    for_jy: 1405,
    for_jm: 6,
  });
  assert.equal(month.join('/'), '1405/6');
});

test('full remaining settlement marks the month paid and advances the reminder', () => {
  resetDb();
  sandbox._db.staff_payments.push({
    id: 13,
    staff_id: 1,
    amount: 20000000,
    date_jalali: '1405/06/16',
    for_jy: 1405,
    for_jm: 6,
  });
  sandbox._reconcileStaffSalaryMonth(1, 1405, 6);
  assert.equal(sandbox._staffRemainingForMonth(sandbox._db.staff[0], 1405, 6), 0);
  assert.equal(sandbox._db.staff_monthly.length, 1);
  assert.equal(sandbox._db.staff_monthly[0].paid, true);
  assert.equal(sandbox._db.staff_reminders[0].due_date_jalali, '1405/07/18');
});

test('staff detail and list surfaces remaining salary after a partial payout', () => {
  assert.match(appSource, /remaining_this_month/);
  assert.match(appSource, /function _staffRemainingForMonth\(/);
  assert.match(extraSource, /حقوق باقی‌مانده این ماه/);
  assert.match(extraSource, /پرداخت‌شده برای این ماه/);
  assert.match(extraSource, /for_jy/);
  assert.match(extraSource, /باقی‌مانده قابل پرداخت/);
});
