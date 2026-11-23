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

test('کل دریافتی uses sum of all toman payments', () => {
  assert.match(app, /function _totalTomanPaymentsReceived\(/);
  assert.match(finance, /const totalReceivedToman = _totalTomanPaymentsReceived\(\)/);
  assert.match(app, /totalReceivedToman != null/);
  const ctx = {
    _db: {
      payments: [
        { amount: 100, currency: 'تومان' },
        { amount: 50, currency: 'تومان', student_id: 99 },
        { amount: 200, currency: 'USD' },
      ],
    },
    _isTomanCurrency: (c) => (c || 'تومان') === 'تومان',
  };
  vm.createContext(ctx);
  vm.runInContext(fn(app, '_totalTomanPaymentsReceived'), ctx);
  assert.equal(ctx._totalTomanPaymentsReceived(), 150);
});

test('account balance table omits status column', () => {
  assert.match(app, /accountBalanceView/);
  assert.match(finance, /accountBalanceView: true/);
  assert.match(app, /const statusTh = accountBalanceView \? '' : '<th>وضعیت<\/th>'/);
  assert.match(finance, /familyGroupsSectionHtml\(families, search = '', \{ showWalletColumn/);
  assert.match(finance, /accountBalanceView: true/);
});

test('studentAccountBalanceHtml does not repeat طلب in amount', () => {
  const ctx = { fmt: (n) => String(n) };
  vm.createContext(ctx);
  vm.runInContext(fn(app, 'studentAccountBalanceHtml'), ctx);
  const html = ctx.studentAccountBalanceHtml(-22894000);
  assert.match(html, /طلبکار/);
  assert.doesNotMatch(html, /طلب طلبکار/);
  assert.doesNotMatch(html, />\s*ت\s*طلب/);
});

test('wallet column hidden when no customer has wallet', () => {
  assert.match(app, /showWalletColumn/);
  assert.match(finance, /showWalletColumn = financeStudents\.some/);
  assert.match(app, /const walletTh = showWalletColumn \? '<th>کیف پول<\/th>' : ''/);
});

test('default sort puts larger debtor first', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fn(app, '_sortAccountStudentsDefault'), ctx);
  const sorted = ctx._sortAccountStudentsDefault([
    { name: 'a', lname: '', balance: 0 },
    { name: 'b', lname: '', balance: 100 },
    { name: 'c', lname: '', balance: 500 },
    { name: 'd', lname: '', balance: -50 },
  ]);
  assert.equal(sorted[0].balance, 500);
  assert.equal(sorted[1].balance, 100);
  assert.equal(sorted[2].balance, -50);
  assert.equal(sorted[3].balance, 0);
});

test('purchase month header sums total_amount + initial_cost', () => {
  const ctx = {
    JMONTHS: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
    fa: (n) => String(n),
    fmt: (n) => String(n),
    escapeHtml: (s) => String(s),
    _isTomanCurrency: () => true,
    _moneyCurrency: (c) => c,
  };
  vm.createContext(ctx);
  vm.runInContext(fn(finance, '_purchaseMonthTomanAmount'), ctx);
  vm.runInContext(fn(finance, '_purchasesMonthHeaderStats'), ctx);
  vm.runInContext(fn(finance, '_purchasesMonthHeaderLabel'), ctx);
  const stats = ctx._purchasesMonthHeaderStats(
    [{ total_amount: 1000, initial_cost: 200, currency: 'تومان' }],
    [{ total_amount: 1000, initial_cost: 200, currency: 'تومان' }],
  );
  assert.equal(stats.tomanSum, 1200);
  const label = ctx._purchasesMonthHeaderLabel({ jy: 1405, jm: 8, key: 140508 }, stats);
  assert.match(label, /فروش/);
  assert.match(label, /جمع 1200 تومان/);
});

test('reminder purchase note prefix becomes از یادآوری badge', () => {
  const ctx = { escapeHtml: (s) => String(s) };
  vm.createContext(ctx);
  vm.runInContext(fn(finance, '_purchaseNoteDisplayHtml'), ctx);
  const note = 'از یادآوری پرداخت: سررسید پرداخت: تجدید کوچینگ شش ماهه';
  const html = ctx._purchaseNoteDisplayHtml(note);
  assert.match(html, /purchase-from-reminder-chip/);
  assert.match(html, /از یادآوری/);
  assert.doesNotMatch(html, /یادآوری پرداخت:/);
  assert.doesNotMatch(html, /سررسید پرداخت:/);
  const withExtra = 'از یادآوری پرداخت: سررسید پرداخت: x · متن کاربر';
  const html2 = ctx._purchaseNoteDisplayHtml(withExtra);
  assert.match(html2, /متن کاربر/);
});

test('mobile css exposes mpay-list for each finance table that renders cards', () => {
  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
  const tables = new Set();
  const marker = "'<div class=\"mpay-list\">'";
  let from = 0;
  while (from < finance.length) {
    const at = finance.indexOf(marker, from);
    if (at < 0) break;
    const window = finance.slice(Math.max(0, at - 3000), at);
    const hits = window.match(/customer-[\w-]+-table/g);
    if (hits?.length) tables.add(hits[hits.length - 1]);
    from = at + marker.length;
  }
  assert.ok(tables.size >= 2, 'expected payments and sales mpay tables');
  for (const tbl of tables) {
    const sel = `.${tbl} .mpay-list`;
    const at = css.indexOf(sel);
    assert.ok(at >= 0, `${tbl} missing mobile mpay-list rule`);
    assert.match(css.slice(at, at + 180), /display:\s*block/);
    assert.match(css, new RegExp(`\\.${tbl.replace(/-/g, '\\-')}:has\\(\\.mpay-list\\) table`));
    assert.match(css, new RegExp(`\\.${tbl.replace(/-/g, '\\-')} \\.mpay-card \\.row-menu-btn`));
  }
  assert.doesNotMatch(finance, /customer-reminders-table[\s\S]{0,1200}'<div class="mpay-list">'/);
});

test('purchase mobile mpay meta omits empty fields', () => {
  assert.match(finance, /function _purchaseMobileMetaParts\(/);
  const fnBody = finance.slice(finance.indexOf('function _purchaseMobileMetaParts'), finance.indexOf('function _purchaseHistoryMobileCardHtml'));
  assert.doesNotMatch(fnBody, /: '—'/);
  assert.match(fnBody, /if \(staff\) parts\.push/);
  assert.match(fnBody, /if \(startDisp\) parts\.push/);
  assert.match(fnBody, /if \(dueDisp\)/);
});

test('asset version tp442', () => {
  assert.match(app, /const TP_ASSET_V = 'tp442'/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /team-pulse-static-v442/);
  assert.match(fs.readFileSync(path.join(root, 'app.html'), 'utf8'), /app\.js\?v=tp442/);
  assert.match(fs.readFileSync(path.join(root, 'app.html'), 'utf8'), /tp402/);
});