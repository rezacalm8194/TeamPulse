const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extraSource = fs.readFileSync(path.join(root, 'app-extra.js'), 'utf8').replace(/\r\n/g, '\n');
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

function sandboxFor(source) {
  const sb = {
    _db: { staff: [{ id: 6, name: 'مهدی', lname: 'صفری' }], expenses: [], _deletedItems: {} },
    deltas: [],
    deleted: [],
    _nextId(col) { return Math.max(0, ...sb._db[col].map(x => Number(x.id) || 0)) + 1; },
    _recordDeletedItems(col, ids) { sb.deleted.push([col, ids]); },
    _enqueueDurableBusinessDelta(col, row, op) { sb.deltas.push([col, row.id, op]); },
  };
  vm.createContext(sb);
  vm.runInContext(extractFunction(source, '_syncStaffPaymentExpense') + '\n' + extractFunction(source, '_removeStaffPaymentExpense'), sb);
  return sb;
}

for (const [label, source] of [['app.js', appSource], ['app-extra.js', extraSource]]) {
  test(`${label}: editing a staff payment without expense_id updates its expense instead of adding one`, () => {
    const sb = sandboxFor(source);
    sb._db.expenses.push({ id: 5, amount: 5000000, source: 'staff_payment', staff_payment_id: 15 });
    sb._db.expenses.push({ id: 6, amount: 5000000, source: 'staff_payment', staff_payment_id: '15' });
    sb._db.expenses.push({ id: 7, amount: 900, source: 'manual' });
    const payment = { id: 15, staff_id: 6, amount: 6000000, date_jalali: '1405/06/31' };
    vm.runInContext('globalThis.r = _syncStaffPaymentExpense(' + JSON.stringify(payment) + ')', sb);
    const linked = sb._db.expenses.filter(e => String(e.staff_payment_id) === '15');
    assert.equal(linked.length, 1);
    assert.equal(linked[0].id, 5);
    assert.equal(linked[0].amount, 6000000);
    assert.ok(sb._db.expenses.some(e => e.id === 7));
    assert.deepEqual(sb.deleted, [['expenses', 6]]);
  });

  test(`${label}: deleting a staff payment removes every linked expense with a tombstone`, () => {
    const sb = sandboxFor(source);
    sb._db.expenses.push({ id: 5, source: 'staff_payment', staff_payment_id: 15 });
    sb._db.expenses.push({ id: 6, source: 'staff_payment', staff_payment_id: 15 });
    sb._db.expenses.push({ id: 7, source: 'manual' });
    vm.runInContext('_removeStaffPaymentExpense({ id: 15, staff_id: 6 })', sb);
    assert.deepEqual(sb._db.expenses.map(e => e.id), [7]);
    assert.equal(sb.deleted.length, 2);
    assert.ok(sb.deltas.every(d => d[2] === 'delete'));
  });
}

test('quantity sales show the total first, then qty × unit price', () => {
  const sb = { fa: String, fmt: n => String(n), _moneyCurrency: () => 'تومان' };
  vm.createContext(sb);
  vm.runInContext(extractFunction(appSource, '_moneyLabel'), sb);
  const label = vm.runInContext('_moneyLabel(147200000, "toman", 92, 1600000)', sb);
  assert.match(label, /^147200000 تومان/);
  assert.match(label, /\(92 × 1600000\)/);
  assert.equal(vm.runInContext('_moneyLabel(5000, "toman", 1)', sb), '5000 تومان');
  assert.doesNotMatch(financeSource, /_moneyLabel\(p\.total_amount, p\.currency, p\.quantity\)/);
});

test('ending cooperation keeps history and drops salary commitment', () => {
  assert.match(appSource, /setActive: \(p\)=>/);
  assert.match(appSource, /totalMonthlySalary=_db\.staff\.filter\(s=>s\.is_active!==false/);
  assert.match(appSource, /if\(rm>0&&s\.is_active!==false&&s\.is_active!==0\)/);
  assert.match(extraSource, /async function setStaffActive\(/);
  assert.match(extraSource, /value: 'end'/);
  assert.match(extraSource, /پایان همکاری/);
});
