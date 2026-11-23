const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const financeSource = fs.readFileSync(path.join(root, 'app-finance.js'), 'utf8').replace(/\r\n/g, '\n');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unclosed ${name}`);
}

test('renewal from reminder or sale asks for the amount instead of saving at the old price', () => {
  const fromReminder = extractFunction(financeSource, 'savePurchaseFromReminder');
  const fromSale = extractFunction(financeSource, 'savePurchaseFromSale');
  assert.match(fromReminder, /_openCyclePurchaseConfirm\(/);
  assert.doesNotMatch(fromReminder, /_saveCyclePurchase\(/);
  assert.match(fromSale, /_openCyclePurchaseConfirm\(/);
  assert.match(fromSale, /rem && Number\(rem\.amount\) > 0/);
  assert.match(extractFunction(financeSource, 'confirmCyclePurchase'), /next_amount: changed && carry/);
  assert.match(financeSource, /next_amount: spec\.next_amount/);
  assert.match(appSource, /if\(Number\(p\.next_amount\)>0\)r\.amount=Math\.round\(Number\(p\.next_amount\)\)/);
});

test('bulk price change math: percent/add rounded, set exact', () => {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(extractFunction(financeSource, '_renewalNewAmount'), sb);
  assert.equal(vm.runInContext('_renewalNewAmount(75000000, "percent", 20, 100000)', sb), 90000000);
  assert.equal(vm.runInContext('_renewalNewAmount(1700000, "percent", 15, 100000)', sb), 2000000);
  assert.equal(vm.runInContext('_renewalNewAmount(6000000, "add", 1500000, 100000)', sb), 7500000);
  assert.equal(vm.runInContext('_renewalNewAmount(6000000, "set", 7250000, 1000000)', sb), 7250000);
});

test('setAmounts changes only open reminders and only their amount', () => {
  const start = appSource.indexOf('setAmounts: (list)=>{');
  assert.notEqual(start, -1);
  const end = appSource.indexOf('\n    },', start);
  const body = appSource.slice(start + 'setAmounts: '.length, end + 6);
  const sb = {
    _db: { reminders: [
      { id: 1, amount: 100, done: false, title: 't', due_date_jalali: '1405/10/01' },
      { id: 2, amount: 100, done: true },
      { id: 3, amount: 100, done: false },
    ] },
    saved: 0, deltas: 0,
    _save() { sb.saved++; },
    _P: v => v,
    _enqueueDurableBusinessDelta() { sb.deltas++; },
  };
  vm.createContext(sb);
  const res = vm.runInContext(`(${body.replace(/,\s*$/, '')})([{id:1,amount:120},{id:2,amount:120},{id:3,amount:0},{id:9,amount:5}])`, sb);
  assert.equal(res.updated, 1);
  assert.equal(sb._db.reminders[0].amount, 120);
  assert.equal(sb._db.reminders[0].due_date_jalali, '1405/10/01');
  assert.equal(sb._db.reminders[1].amount, 100);
  assert.equal(sb._db.reminders[2].amount, 100);
  assert.equal(sb.saved, 1);
  assert.equal(sb.deltas, 1);
});

test('bulk price groups by the reminder title, not the sale service', () => {
  const sb = { _normalizePackageTypeTitle: v => String(v).replace(/^تجدید پکیج:\s*/, '') || 'خرید جدید' };
  vm.createContext(sb);
  vm.runInContext(extractFunction(financeSource, '_renewalServiceLabel'), sb);
  sb.pk = new Map([['5', { type_id: 2 }]]);
  sb.ty = new Map([['2', { label: 'سایت' }]]);
  assert.equal(vm.runInContext('_renewalServiceLabel({ title: "هاست دانلود ", package_id: 5 }, pk, ty)', sb), 'هاست دانلود');
  assert.equal(vm.runInContext('_renewalServiceLabel({ title: "سررسید پرداخت: کوچینگ" }, pk, ty)', sb), 'کوچینگ');
  assert.equal(vm.runInContext('_renewalServiceLabel({ title: "", package_id: 5 }, pk, ty)', sb), 'سایت');
});
