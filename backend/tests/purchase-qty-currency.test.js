const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

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
  _ALL_CURRENCIES: ['تومان', 'درهم', 'دلار', 'یورو'],
  fa: n => String(n),
  fmt: n => String(n),
  escapeHtml: s => String(s ?? ''),
};
vm.createContext(sandbox);
for (const name of [
  '_moneyCurrency', '_isTomanCurrency', '_packageQuantity', '_packageQtyPersist',
  '_isPackageChargeable', '_packageDefersUntilDue', '_packagePaymentDueDate',
  '_fxBooksFrom', '_splitPurchasePayments',
]) {
  vm.runInContext(extractFunction(app, name), sandbox);
}

test('line total is quantity times unit price and keeps currency', () => {
  const qty = sandbox._packageQtyPersist({ quantity: 3, unit_price: 4000000, currency: 'تومان' });
  assert.equal(qty.quantity, 3);
  assert.equal(qty.total_amount, 12000000);
  assert.equal(qty.currency, 'تومان');
  const fx = sandbox._packageQtyPersist({ quantity: 2, unit_price: 348, currency: 'درهم' });
  assert.equal(fx.currency, 'درهم');
  assert.equal(fx.total_amount, 696);
});

test('toman balance ignores dirham contracts while fx books keep them', () => {
  const packages = [
    { total_amount: 6800000, initial_cost: 0, currency: 'تومان' },
    { total_amount: 348, initial_cost: 0, currency: 'درهم' },
  ];
  const payments = [
    { amount: 6800000, currency: 'تومان' },
    { amount: 200, currency: 'درهم' },
  ];
  const books = sandbox._fxBooksFrom(packages, payments);
  assert.equal(books.length, 1);
  assert.equal(books[0].currency, 'درهم');
  assert.equal(books[0].contract, 348);
  assert.equal(books[0].paid, 200);
  assert.equal(books[0].balance, 148);
  assert.equal(sandbox._isTomanCurrency('درهم'), false);
});

test('current payment splits only across matching-currency line totals', () => {
  const tomanLines = [4000000, 0, 2000000];
  assert.deepEqual(sandbox._splitPurchasePayments(tomanLines, 5000000), [4000000, 0, 1000000]);
});
