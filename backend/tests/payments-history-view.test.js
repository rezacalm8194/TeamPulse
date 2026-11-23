const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const finance = fs.readFileSync(path.join(root, 'app-finance.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

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

test('payments table omits مانده حساب column', () => {
  const start = finance.indexOf("} else if (tab === 'payments')");
  const end = finance.indexOf('setContent(html + morePayments);', start);
  const paymentsBlock = finance.slice(start, end);
  assert.doesNotMatch(paymentsBlock, /<th>مانده حساب<\/th>/);
  assert.doesNotMatch(paymentsBlock, /data-label="مانده حساب"/);
});

test('account deposit column is conditional', () => {
  assert.match(finance, /function _paymentsHistoryShowAccountColumn\(/);
  assert.match(finance, /const showAccountColumn = _paymentsHistoryShowAccountColumn/);
  assert.match(finance, /const accountTh = showAccountColumn \? '<th>واریز به حساب<\/th>' : ''/);
  const ctx = { _db: { financial_accounts: [] } };
  vm.createContext(ctx);
  vm.runInContext(fn(finance, '_paymentsHistoryShowAccountColumn'), ctx);
  assert.equal(ctx._paymentsHistoryShowAccountColumn([{ account_id: null }]), false);
  assert.equal(ctx._paymentsHistoryShowAccountColumn([{ account_id: 3 }]), true);
  ctx._db.financial_accounts = [{ id: 1 }];
  assert.equal(ctx._paymentsHistoryShowAccountColumn([]), true);
});

test('month header shows jalali month and count', () => {
  const ctx = {
    JMONTHS: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
    fa: (n) => String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]),
    fmt: (n) => String(n),
    escapeHtml: (s) => String(s),
  };
  vm.createContext(ctx);
  vm.runInContext(fn(finance, '_paymentsMonthHeaderLabel'), ctx);
  const label = ctx._paymentsMonthHeaderLabel({ jy: 1405, jm: 8, key: 140508 }, {
    count: 16,
    tomanSum: 1200000,
    fx: new Map(),
    partial: false,
  });
  assert.match(label, /آبان/);
  assert.match(label, /۱۶ دریافت/);
  assert.match(label, /جمع 1200000 تومان/);
});

test('orphan-free payment without package shows پرداخت به حساب', () => {
  const ctx = {
    escapeHtml: (s) => String(s),
    incomeFilterButton: () => '',
  };
  vm.createContext(ctx);
  vm.runInContext(fn(app, '_paymentOrphanPackageBadgeHtml'), ctx);
  vm.runInContext(fn(finance, '_paymentHistoryPackageCell'), ctx);
  const html = ctx._paymentHistoryPackageCell({ package_id: null });
  assert.match(html, /پرداخت به حساب/);
});

test('mobile uses inline income search and hides topbar duplicate', () => {
  assert.match(finance, /income-inline-search/);
  assert.match(finance, /income-topbar-search/);
  assert.match(finance, /جست‌وجو در همین فهرست…/);
  assert.match(fs.readFileSync(path.join(root, 'app.css'), 'utf8'), /\.topbar-actions \.income-topbar-search \{ display: none !important; \}/);
});

test('asset versions aligned', () => {
  const { assertTpAssetVersionsAligned } = require('./tp-asset-version');
  assertTpAssetVersionsAligned(root);
});