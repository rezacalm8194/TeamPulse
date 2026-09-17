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
};
vm.createContext(sandbox);
for (const name of [
  '_jalaliParse',
  '_jalaliKey',
  '_formatJalali',
  '_packagePaymentDueDate',
  '_packageDefersUntilDue',
  '_packageChargeDate',
  '_packageDeferPersist',
  '_isPackageChargeable',
]) {
  vm.runInContext(extractFunction(appSource, name), sandbox);
}
sandbox._todayJalali = () => [1405, 6, 20];

test('deferred purchase is not chargeable before the due date', () => {
  const pkg = {
    defer_until_due: true,
    charge_date: '۱۴۰۵/۰۷/۲۰',
    payment_due_date: '۱۴۰۵/۰۷/۲۰',
    total_amount: 15000000,
  };
  assert.equal(sandbox._isPackageChargeable(pkg), false);
});

test('deferred purchase becomes chargeable on the due date', () => {
  sandbox._todayJalali = () => [1405, 7, 20];
  const pkg = {
    defer_until_due: true,
    charge_date: '۱۴۰۵/۰۷/۲۰',
    payment_due_date: '۱۴۰۵/۰۷/۲۰',
    total_amount: 15000000,
  };
  assert.equal(sandbox._isPackageChargeable(pkg), true);
});

test('unchecked purchases stay chargeable immediately', () => {
  sandbox._todayJalali = () => [1405, 6, 20];
  const pkg = {
    payment_due_date: '۱۴۰۵/۰۷/۲۰',
    start_date: '۱۴۰۵/۰۶/۲۰',
    total_amount: 15000000,
  };
  assert.equal(sandbox._isPackageChargeable(pkg), true);
});

test('rolling the reminder due date does not uncharge a package already due', () => {
  sandbox._todayJalali = () => [1405, 7, 25];
  const persisted = sandbox._packageDeferPersist(
    { defer_until_due: true, payment_due_date: '۱۴۰۵/۰۸/۲۰' },
    { defer_until_due: true, charge_date: '۱۴۰۵/۰۷/۲۰', payment_due_date: '۱۴۰۵/۰۷/۲۰' }
  );
  assert.equal(persisted.charge_date, '۱۴۰۵/۰۷/۲۰');
  assert.equal(sandbox._isPackageChargeable({ ...persisted, payment_due_date: '۱۴۰۵/۰۸/۲۰' }), true);
});
