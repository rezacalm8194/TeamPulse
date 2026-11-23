const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const finance = fs.readFileSync(path.join(root, 'app-finance.js'), 'utf8');

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

function extractPaymentsGetAll(source) {
  const coll = source.indexOf('payments: {');
  const start = source.indexOf('getAll: ()=>{', coll);
  assert.ok(start > coll);
  let i = source.indexOf('{', start + 'getAll: '.length);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('getAll not closed');
}

test('payments getAll has no 300-row cap and uses package maps', () => {
  assert.doesNotMatch(app, /_sortPaymentsNewestFirst\(_db\.payments\)\.slice\(0,300\)/);
  assert.match(app, /const pkgById = new Map\(\(_db\.packages/);
  assert.match(app, /const ptById = new Map\(\(_db\.package_types/);
});

test('getAll returns all 400 sample payments with labels', async () => {
  const src = extractPaymentsGetAll(app);
  const ctx = {
    Map,
    _db: {
      payments: Array.from({ length: 400 }, (_, i) => ({
        id: i + 1,
        student_id: 1,
        package_id: 10,
        amount: 1000,
        currency: 'تومان',
        date_jalali: '1404/01/10',
      })),
      packages: [{ id: 10, student_id: 1, type_id: 2 }],
      package_types: [{ id: 2, label: 'مشاوره', color: '#7c6af7' }],
      students: [{ id: 1, name: 'علی', lname: 'رضایی' }],
      financial_accounts: [],
    },
    _P: (v) => Promise.resolve(v),
  };
  vm.createContext(ctx);
  vm.runInContext(fn(app, '_jalaliParse'), ctx);
  vm.runInContext(fn(app, '_jalaliKey'), ctx);
  vm.runInContext(fn(app, '_sortPaymentsNewestFirst'), ctx);
  const inner = src.replace(/^getAll:\s*/, '').replace(/,\s*$/, '');
  vm.runInContext(`var _paymentsGetAll = ${inner};`, ctx);
  const rows = await ctx._paymentsGetAll();
  assert.equal(rows.length, 400);
  assert.equal(rows[0].pkg_label, 'مشاوره');
  assert.equal(rows[0].name, 'علی');
});

test('month header sum includes all payments in old jalali month', () => {
  const ctx = {
    JMONTHS: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
    fa: (n) => String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]),
    fmt: (n) => String(n),
    escapeHtml: (s) => String(s),
    _isTomanCurrency: (c) => !c || c === 'تومان',
    _moneyCurrency: (c) => c || 'تومان',
  };
  vm.createContext(ctx);
  vm.runInContext(fn(finance, '_paymentsMonthHeaderStats'), ctx);
  vm.runInContext(fn(finance, '_paymentsMonthHeaderLabel'), ctx);
  const payments = Array.from({ length: 400 }, (_, i) => ({
    id: i + 1,
    amount: 250,
    currency: 'تومان',
    date_jalali: '1403/12/28',
  }));
  const stats = ctx._paymentsMonthHeaderStats(payments, payments);
  assert.equal(stats.count, 400);
  assert.equal(stats.tomanSum, 100000);
  const mk = 140312;
  const label = ctx._paymentsMonthHeaderLabel(
    { jy: 1403, jm: 12, key: mk },
    stats,
  );
  assert.match(label, /اسفند/);
  assert.match(label, /جمع 100000 تومان/);
});

test('asset version tp446', () => {
  assert.match(app, /const TP_ASSET_V = 'tp446'/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /team-pulse-static-v446/);
});