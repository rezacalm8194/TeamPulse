const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const app = read('app.js');
const finance = read('app-finance.js');
const j = x => JSON.parse(JSON.stringify(x));

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

function financeVm(db, extra = {}) {
  const ctx = {
    _db: db,
    Date,
    Map,
    Object,
    Array,
    String,
    Number,
    Math,
    allStudents: [],
    _studentListSummaryCache: null,
    console,
    ...extra,
  };
  ctx._rowsForStudent = (collection, studentId) => (db[collection] || []).filter(row => Number(row.student_id) === Number(studentId));
  ctx._studentListSummary = (s) => {
    if (!s) return s;
    const packages = ctx._rowsForStudent('packages', s.id);
    const payments = ctx._rowsForStudent('payments', s.id);
    const totalAmount = packages.reduce((a, p) => a + (p.total_amount || 0), 0);
    const totalPaid = payments.reduce((a, p) => a + (p.amount || 0), 0);
    const wallet = s.wallet || 0;
    return { ...s, packages, totalAmount, totalPaid, wallet, balance: totalAmount - totalPaid - wallet, sessionCount: 0, otherPayments: null, fxBooks: null };
  };
  ctx._isPaymentReminder = (r) => {
    if (!r) return false;
    const source = String(r.source || '');
    if (source === 'session_followup' || source === 'auto_stale_lead' || source === 'archive_followup') return false;
    const title = String(r.title || '').trim();
    return !(title.startsWith('اقدام جلسه') || title.startsWith('پیگیری بایگانی:') || title.startsWith('پیگیری راکد'));
  };
  const financeBlockStart = app.indexOf('const _FINANCE_DECISION_PARTS');
  const financeBlockEnd = app.indexOf('function _paymentOrphanPackageBadgeHtml');
  const financeBlock = app.slice(financeBlockStart, financeBlockEnd);
  const helpers = [
    '_studentsForFinance',
    '_resolveStudentFinanceSummary',
    '_isPaymentReminder',
    '_isPackageRenewalReminder',
    '_studentArchiveFinanceDebt',
    '_reminderPausedByArchive',
    '_pendingPaymentReminderCount',
  ];
  const src = financeBlock + helpers.map(n => fn(app, n)).join('\n');
  ctx.fa = (n) => String(n);
  ctx.fmt = (n) => String(n);
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis._studentsForFinance=_studentsForFinance;this._studentFinanceRecordCounts=_studentFinanceRecordCounts;this._studentHasFinanceRecords=_studentHasFinanceRecords;this._resolveStudentFinanceSummary=_resolveStudentFinanceSummary;this._ensureFinancePartsFreshForDecision=_ensureFinancePartsFreshForDecision;this._reminderPausedByArchive=_reminderPausedByArchive;this._pendingPaymentReminderCount=_pendingPaymentReminderCount;this._isPackageRenewalReminder=_isPackageRenewalReminder;', ctx);
  return ctx;
}

test('_studentsForFinance includes archived debtor, excludes archived with zero balance', () => {
  const db = {
    students: [
      { id: 1, name: 'فعال', archived: false, wallet: 0 },
      { id: 2, name: 'بایگانی بدهکار', archived: true, wallet: 0 },
      { id: 3, name: 'بایگانی تسویه', archived: true, wallet: 0 },
    ],
    packages: [
      { id: 10, student_id: 1, type_id: 1, total_amount: 0, initial_cost: 0, currency: 'تومان' },
      { id: 11, student_id: 2, type_id: 1, total_amount: 1000, initial_cost: 0, currency: 'تومان' },
    ],
    payments: [],
    package_types: [{ id: 1, label: 'خدمت', color: '#888', key: 'svc' }],
    reminders: [],
  };
  const ctx = financeVm(db);
  const list = ctx._studentsForFinance();
  const ids = list.map(s => s.id);
  assert.ok(ids.includes(1));
  assert.ok(ids.includes(2));
  assert.ok(!ids.includes(3));
  assert.equal(list.find(s => s.id === 2).archived, true);
});

test('archived settled with open package renewal reminder is not in _studentsForFinance', () => {
  const db = {
    students: [{ id: 5, name: 'A', archived: true, wallet: 0 }],
    packages: [],
    payments: [],
    package_types: [],
    reminders: [{ id: 1, student_id: 5, done: false, title: 'تجدید پکیج کوچینگ', amount: 100 }],
  };
  const ctx = financeVm(db);
  assert.ok(!ctx._studentsForFinance().some(s => s.id === 5));
});

test('openAddPayment opens form for archived customer with balance', () => {
  assert.match(fn(app, 'openAddPayment'), /_resolveStudentFinanceSummary\(studentId\)/);
  assert.match(fn(app, 'openAddPayment'), /این مشتری بایگانی شده است/);
  let modalTitle = '';
  const db = {
    students: [{ id: 9, name: 'آرش', lname: 'بایگانی', archived: true, wallet: 0 }],
    packages: [{ id: 1, student_id: 9, type_id: 1, total_amount: 400, currency: 'تومان' }],
    payments: [],
    package_types: [{ id: 1, label: 'مشاوره', color: '#888', key: 'c' }],
    reminders: [],
  };
  const ctx = financeVm(db, {
    openModal: (title) => { modalTitle = title; },
    paymentPackageOptionsHtml: () => '<option></option>',
    uniquePaymentPackageOptions: () => [],
    newPurchaseHintHtml: () => '',
    quickNewPackageFieldsHtml: () => '',
    currencyOptions: () => '',
    financialAccountOptionsHtml: () => '',
    formatJalali: () => '',
    todayJalali: () => [1404, 1, 1],
    balanceHtml: () => '',
    escapeHtml: s => String(s),
    initDatePickers: () => {},
  });
  vm.runInContext(fn(app, 'openAddPayment') + '\nthis.openAddPayment=openAddPayment;', ctx);
  ctx.openAddPayment(9);
  assert.match(modalTitle, /آرش/);
});

test('totalDebt includes archived debtor balance', () => {
  const db = {
    students: [
      { id: 1, name: 'A', archived: false, wallet: 0 },
      { id: 2, name: 'B', archived: true, wallet: 0 },
    ],
    packages: [
      { id: 1, student_id: 1, type_id: 1, total_amount: 0, currency: 'تومان' },
      { id: 2, student_id: 2, type_id: 1, total_amount: 500, currency: 'تومان' },
    ],
    payments: [],
    package_types: [{ id: 1, label: 'x', color: '#888', key: '' }],
    reminders: [],
  };
  const ctx = financeVm(db);
  const financeStudents = ctx._studentsForFinance();
  const totalDebt = financeStudents.reduce((a, s) => a + Math.max(0, s.balance), 0);
  assert.equal(totalDebt, 500);
  assert.match(fn(app, 'studentAccountOverviewHtml'), /statsStudents/);
});

test('archived settled renewal reminder paused; unarchive resumes count', () => {
  const db = {
    students: [{ id: 7, name: 'Z', archived: true, wallet: 0 }],
    packages: [],
    payments: [],
    reminders: [{ id: 1, student_id: 7, done: false, title: 'تجدید پکیج کوچینگ' }],
  };
  const ctx = financeVm(db);
  assert.equal(ctx._pendingPaymentReminderCount(db.reminders), 0);
  db.students[0].archived = false;
  assert.equal(ctx._pendingPaymentReminderCount(db.reminders), 1);
});

test('archived debtor payment-due reminder stays visible in badge count', () => {
  const db = {
    students: [{ id: 8, name: 'D', archived: true, wallet: 0 }],
    packages: [{ id: 1, student_id: 8, total_amount: 500, currency: 'تومان' }],
    payments: [],
    reminders: [{ id: 2, student_id: 8, done: false, title: 'سررسید پرداخت: کوچینگ' }],
  };
  const ctx = financeVm(db);
  assert.equal(ctx._pendingPaymentReminderCount(db.reminders), 1);
  assert.equal(ctx._reminderPausedByArchive(db.reminders[0]), false);
});

test('studentAccountOverviewHtml counts settled only among active students', () => {
  assert.match(app, /const settledCount = students\.filter\(s => s\.balance <= 0\)/);
});

test('deleteStudent blocks hard delete when payments exist', () => {
  assert.match(fn(app, 'deleteStudent'), /_ensureFinancePartsFreshForDecision/);
  assert.match(fn(app, 'deleteStudent'), /_studentHasFinanceRecords\(id\)/);
  assert.doesNotMatch(fn(app, 'deleteStudent'), /_studentHasFinanceRecords\(id\)[\s\S]{0,500}window\.api\.students\.delete\(id\)/);
});

test('deleteStudent shows alert and does not delete when payments part is not fresh', async () => {
  const db = { students: [{ id: 1, name: 'الف', lname: 'ب', wallet: 0 }], packages: [], payments: [], wallet_tx: [] };
  let alertMsg = '';
  let undoCalled = false;
  const ctx = financeVm(db);
  Object.assign(ctx, {
    allStudents: [{ id: 1, name: 'الف', lname: 'ب' }],
    _ensureCompleteBusinessParts: async () => {},
    _businessPartCompleteAndFresh: (key) => key !== 'payments',
    tpAlert: async (m) => { alertMsg = m; },
    tpConfirm: async () => true,
    _tpDialog: async () => null,
    _archiveStudentWithBalanceConfirm: async () => false,
    _tpUndoableDelete: async () => { undoCalled = true; },
    refreshOpenStudentSurface: async () => {},
    showToast: () => {},
    window: { api: { students: { getAll: async () => [], delete: () => { undoCalled = true; } } } },
  });
  vm.runInContext(fn(app, 'deleteStudent') + '\nthis.deleteStudent=deleteStudent;', ctx);
  await ctx.deleteStudent(1);
  assert.match(alertMsg, /کامل بارگذاری نشد/);
  assert.equal(undoCalled, false);
  assert.equal(db.students.length, 1);
});

test('customer with wallet balance only cannot be hard-deleted', () => {
  const db = {
    students: [{ id: 4, name: 'کیف', archived: false, wallet: 250 }],
    packages: [],
    payments: [],
    wallet_tx: [],
  };
  const ctx = financeVm(db);
  assert.ok(ctx._studentHasFinanceRecords(4));
  assert.match(fn(app, 'deleteStudent'), /_studentHasFinanceRecords\(id\)/);
  const counts = ctx._studentFinanceRecordCounts(4);
  assert.equal(counts.walletBalance, 250);
});

test('archived customer with foreign-currency balance appears in _studentsForFinance', () => {
  const db = {
    students: [{ id: 8, name: 'FX', archived: true, wallet: 0 }],
    packages: [],
    payments: [],
    package_types: [],
    reminders: [],
  };
  const ctx = financeVm(db);
  const orig = ctx._studentListSummary;
  ctx._studentListSummary = (s) => ({ ...orig(s), balance: 0, fxBooks: [{ currency: 'USD', contract: 100, paid: 0, balance: 100 }] });
  assert.ok(ctx._studentsForFinance().some(s => s.id === 8));
});

test('deletePackage awaits finance parts before counting related payments', () => {
  assert.match(finance, /async function deletePackage\(id\) \{[\s\S]*?if \(!await _ensureFinancePartsFreshForDecision\(\)\) return;/);
  const body = fn(finance, 'deletePackage');
  assert.ok(body.indexOf('_ensureFinancePartsFreshForDecision') < body.indexOf('relatedPayments'));
});

test('deletePackage with payments offers both / pkg_only and deletes related payments on both', async () => {
  assert.match(finance, /حذف خرید و پرداخت‌هایش/);
  assert.match(finance, /const collections = deletePayments \? \['packages', 'reminders', 'payments'\]/);
  const undoStart = app.indexOf('// ── Undo after delete');
  const undoEnd = app.indexOf('function showToast(', undoStart);
  const undoSrc = app.slice(undoStart, undoEnd);
  const db = {
    packages: [{ id: 7, student_id: 1, type_id: 1, total_amount: 1000 }],
    payments: [{ id: 11, student_id: 1, package_id: 7, amount: 200 }],
    reminders: [{ id: 3, student_id: 1, package_id: 7, done: false, title: 'پرداخت' }],
    package_types: [{ id: 1, label: 'x' }],
    _deletedItems: {},
  };
  const ctx = {
    window: { api: {
      payments: { delete: id => { db.payments = db.payments.filter(p => p.id !== id); return Promise.resolve({ ok: true }); } },
      packages: { delete: id => { db.packages = db.packages.filter(p => p.id !== id); db.reminders = (db.reminders || []).filter(r => String(r.package_id) !== String(id)); return Promise.resolve({ ok: true }); } },
    } },
    _db: db,
    allStudents: [],
    currentPage: 'payments',
    Date, Set, Map, Object, Array, console,
    document: { getElementById: () => null, createElement: () => ({ className: '', style: {}, classList: { add() {} }, setAttribute() {}, addEventListener() {}, appendChild() {}, append() {}, remove() {} }), body: { appendChild() {} }, querySelectorAll: () => [] },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {},
    showToast() {},
    renderPayments: async () => {},
    renderPage: async () => {},
    _save() {},
    _readDurableBusinessDeltaQueue: () => [],
    _writeDurableBusinessDeltaQueue() {},
    _ensurePendingServerSync() {},
  };
  ctx.window._activeDBKey = 'ws';
  vm.createContext(ctx);
  vm.runInContext(undoSrc + '\nthis._tpUndoableDelete=_tpUndoableDelete;', ctx);
  const related = db.payments.filter(p => String(p.package_id) === '7');
  await ctx._tpUndoableDelete({
    collections: ['packages', 'reminders', 'payments'],
    run: async () => {
      for (const p of related) await ctx.window.api.payments.delete(p.id);
      await ctx.window.api.packages.delete(7);
    },
  });
  assert.deepEqual(j(db.payments), []);
  assert.deepEqual(j(db.packages), []);
});

test('deletePackage pkg_only keeps payments', async () => {
  const db = {
    packages: [{ id: 7, student_id: 1 }],
    payments: [{ id: 11, student_id: 1, package_id: 7, amount: 200 }],
    reminders: [],
  };
  db.packages = db.packages.filter(p => p.id !== 7);
  assert.deepEqual(j(db.payments), [{ id: 11, student_id: 1, package_id: 7, amount: 200 }]);
});

test('tpConfirm and tpChoose signatures unchanged for two-button flow', () => {
  assert.match(app, /function tpConfirm\(message, opts = \{\}\) \{\s*const danger = opts\.danger/);
  assert.match(app, /function tpChoose\(message, opts = \{\}\) \{\s*return _tpDialog\(\{ message, okText: opts\.okText/);
  assert.match(app, /function _tpDialog\(\{[^\}]*buttons = null/);
  assert.match(app, /const buttonDefs = Array\.isArray\(buttons\) && buttons\.length \? buttons : null/);
});

test('push index skips package renewal for archived settled customer', () => {
  const { computePushDueIndex } = require('../utils/pushDueIndex');
  const nowBeforeNine = new Date('2026-08-23T05:00:00.000Z');
  const schedule = computePushDueIndex('acc', {
    students: [{ id: 3, name: 'A', archived: true, wallet: 0 }],
    packages: [],
    payments: [],
    reminders: [
      { id: 9, student_id: 3, due_date_jalali: '1405/06/01', done: false, title: 'تجدید پکیج کوچینگ', amount: 100 },
    ],
  }, nowBeforeNine, new Set());
  assert.equal(schedule.items.length, 0);
});

test('archive confirm mentions paused renewal reminders', () => {
  assert.match(fn(app, '_archiveStudentWithBalanceConfirm'), /یادآوری‌های تمدید این مشتری تا زمانی که در بایگانی است متوقف می‌شوند/);
});

test('asset version tp444', () => {
  assert.match(app, /const TP_ASSET_V = 'tp444'/);
  assert.match(read('sw.js'), /team-pulse-static-v436/);
});