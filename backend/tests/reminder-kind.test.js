const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const {
  studentHasFinanceDebt,
  studentListSummaryDebt,
  todayJalaliKey,
} = require('../utils/studentFinanceSummary');

/** Fixed instant (Tehran calendar date 1404/11/01) for defer / parity tests */
const FIXED_NOW = new Date('2026-01-21T08:30:00.000Z');

function tehranGregorian(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const out = {};
  parts.forEach((p) => { if (p.type !== 'literal') out[p.type] = Number(p.value); });
  return { year: out.year, month: out.month, day: out.day };
}

function fn(source, name) {
  const match = new RegExp(`(?:async\\s+)?function ${name}\\(`).exec(source);
  assert.ok(match, `${name} missing`);
  let depth = 0;
  for (let i = source.indexOf('{', match.index); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(name);
}

function appFinanceVm(db, nowGregorian) {
  const ctx = {
    _db: db,
    Map,
    Object,
    Array,
    String,
    Number,
    Math,
    Date,
    Intl,
    META: {},
    CURRENCIES: ['تومان', 'دلار'],
    _studentListSummaryCache: null,
    _studentSummaryCache: null,
    _ALL_CURRENCIES: ['تومان', 'درهم', 'دلار', 'یورو'],
    _resolvePackageType: (id) => (db.package_types || []).find((t) => t.id === id),
    console,
  };
  ctx._rowsForStudent = (collection, studentId) =>
    (db[collection] || []).filter((row) => Number(row.student_id) === Number(studentId));
  ctx._appTodayGregorianParts = () => nowGregorian;

  const src = [
    fn(appSource, 'div'),
    fn(appSource, 'mod'),
    fn(appSource, 'gregorianToJalali'),
    fn(appSource, 'jalaliToGregorian'),
    fn(appSource, '_jalaliParse'),
    fn(appSource, '_jalaliKey'),
    fn(appSource, '_formatJalali'),
    fn(appSource, '_todayJalali'),
    fn(appSource, '_moneyCurrency'),
    fn(appSource, '_isTomanCurrency'),
    fn(appSource, '_packagePaymentDueDate'),
    fn(appSource, '_packageDefersUntilDue'),
    fn(appSource, '_packageChargeDate'),
    fn(appSource, '_isPackageChargeable'),
    fn(appSource, '_packageQuantity'),
    fn(appSource, '_fxBooksFrom'),
    fn(appSource, '_studentListSummary'),
    'function _appTodayGregorianParts() { return ' + JSON.stringify(nowGregorian) + '; }',
    'this._rowsForStudent=_rowsForStudent;',
  ].join('\n');

  vm.createContext(ctx);
  vm.runInContext(
    'function _rowsForStudent(collection, studentId) { return (_db[collection] || []).filter(row => Number(row.student_id) === Number(studentId)); }\n'
    + src,
    ctx,
  );
  return ctx;
}

function assertParity(db, studentId, now) {
  const ctx = appFinanceVm(db, tehranGregorian(now));
  const student = db.students.find((s) => s.id === studentId);
  const appSummary = ctx._studentListSummary(student);
  const appHasDebt = appSummary.balance !== 0
    || (appSummary.fxBooks || []).some((b) => Number(b.balance) !== 0);
  const serverDebt = studentHasFinanceDebt(
    { students: db.students, packages: db.packages, payments: db.payments },
    studentId,
    { now },
  );
  assert.equal(serverDebt, appHasDebt, `parity student ${studentId}`);
  return appSummary;
}

test('todayJalaliKey aligns with app on fixed instant', () => {
  const keyServer = todayJalaliKey(FIXED_NOW);
  const ctx = appFinanceVm({ students: [], packages: [], payments: [] }, tehranGregorian(FIXED_NOW));
  const keyApp = ctx._jalaliKey(ctx._formatJalali(...ctx._todayJalali()));
  assert.equal(keyServer, keyApp);
});

test('fully paid purchase with initial_cost is not debtor', () => {
  const db = {
    students: [{ id: 1, wallet: 0 }],
    packages: [{ id: 10, student_id: 1, total_amount: 800, initial_cost: 200, currency: 'تومان' }],
    payments: [{ id: 1, student_id: 1, amount: 1000, currency: 'تومان' }],
    package_types: [],
  };
  assert.equal(studentHasFinanceDebt(db, 1, { now: FIXED_NOW }), false);
  assertParity(db, 1, FIXED_NOW);
});

test('defer_until_due with future payment_due_date is not chargeable (no toman debt)', () => {
  const db = {
    students: [{ id: 2, wallet: 0 }],
    packages: [{
      id: 11,
      student_id: 2,
      total_amount: 5000,
      initial_cost: 0,
      currency: 'تومان',
      defer_until_due: true,
      payment_due_date: '1404/12/01',
    }],
    payments: [],
    package_types: [],
  };
  assert.equal(studentHasFinanceDebt(db, 2, { now: FIXED_NOW }), false);
  const s = studentListSummaryDebt(db.students[0], db.packages, db.payments, FIXED_NOW);
  assert.equal(s.balance, 0);
  assertParity(db, 2, FIXED_NOW);
});

test('defer_until_due with due on or before today counts toward balance', () => {
  const db = {
    students: [{ id: 3, wallet: 0 }],
    packages: [{
      id: 12,
      student_id: 3,
      total_amount: 3000,
      initial_cost: 0,
      currency: 'تومان',
      defer_until_due: true,
      payment_due_date: '1404/11/01',
    }],
    payments: [],
    package_types: [],
  };
  assert.equal(studentHasFinanceDebt(db, 3, { now: FIXED_NOW }), true);
  assertParity(db, 3, FIXED_NOW);
});

test('USD contract does not inflate toman balance', () => {
  const db = {
    students: [{ id: 4, wallet: 0 }],
    packages: [{ id: 13, student_id: 4, total_amount: 100, initial_cost: 0, currency: 'دلار' }],
    payments: [],
    package_types: [],
  };
  const s = studentListSummaryDebt(db.students[0], db.packages, db.payments, FIXED_NOW);
  assert.equal(s.balance, 0);
  assert.equal(studentHasFinanceDebt(db, 4, { now: FIXED_NOW }), true);
  assertParity(db, 4, FIXED_NOW);
});

test('toman payments do not reduce foreign-currency book', () => {
  const db = {
    students: [{ id: 5, wallet: 0 }],
    packages: [{ id: 14, student_id: 5, total_amount: 200, initial_cost: 0, currency: 'دلار' }],
    payments: [{ id: 2, student_id: 5, amount: 999, currency: 'تومان' }],
    package_types: [],
  };
  assert.equal(studentHasFinanceDebt(db, 5, { now: FIXED_NOW }), true);
  assertParity(db, 5, FIXED_NOW);
});

test('wallet reduces toman balance like app', () => {
  const db = {
    students: [{ id: 6, wallet: 500 }],
    packages: [{ id: 15, student_id: 6, total_amount: 1000, initial_cost: 0, currency: 'تومان' }],
    payments: [{ id: 3, student_id: 6, amount: 400, currency: 'تومان' }],
    package_types: [],
  };
  const summary = assertParity(db, 6, FIXED_NOW);
  assert.equal(summary.balance, 100);
  assert.equal(studentHasFinanceDebt(db, 6, { now: FIXED_NOW }), true);
});

test('archived settled: reminderPaused uses server debt parity', () => {
  const { reminderPausedByArchive } = require('../utils/reminderKind');
  const db = {
    students: [{ id: 7, archived: true, wallet: 0 }],
    packages: [{
      id: 16,
      student_id: 7,
      total_amount: 1000,
      initial_cost: 0,
      currency: 'تومان',
      defer_until_due: true,
      payment_due_date: '1405/06/01',
    }],
    payments: [],
  };
  const renewal = { id: 1, student_id: 7, title: 'تجدید پکیج کوچینگ', done: false };
  assert.equal(reminderPausedByArchive(renewal, db), true);
});