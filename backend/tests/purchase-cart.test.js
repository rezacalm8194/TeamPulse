const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

const app = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');

function fn(source, name) {
  const match = new RegExp(`(?:async\\s+)?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  let depth = 0;
  for (let i = source.indexOf('{', match.index); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw Error(name);
}

function load() {
  const context = vm.createContext({
    enDigits(s) { return String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); },
  });
  for (const name of [
    '_serviceLabelKey',
    '_serviceMergeKey',
    '_purchaseAmountFromMatch',
    '_cleanPurchaseQuery',
    '_purchaseServiceTokens',
    '_matchPurchaseService',
    '_parseQuickPurchases',
    '_splitPurchasePayments',
  ]) {
    vm.runInContext(fn(app, name), context);
  }
  return context;
}

test('new purchase form uses a multi-service cart instead of a single select', () => {
  assert.match(app, /function newPurchaseServicePickerHtml/);
  assert.match(app, /np-svc-cb/);
  assert.match(app, /onNewPurchaseQuickInput/);
  assert.match(app, /_splitPurchasePayments/);
  assert.match(app, /حداقل یک خدمت را تیک بزنید/);
  assert.doesNotMatch(fn(app, 'openNewPurchase'), /id="np-type"/);
});

test('quick purchase parser matches catalog names and optional amounts', () => {
  const ctx = load();
  const catalog = [
    { id: 1, label: 'پخت و ریز کردن پگ گوسفندی' },
    { id: 2, label: 'خورش قیمه' },
    { id: 3, label: 'سالاد فصل' },
  ];
  const items = ctx._parseQuickPurchases('پگ گوسفندی\nخورش قیمه ۸۰۰ هزار\nسالاد', catalog);
  assert.equal(items.length, 3);
  assert.equal(items[0].status, 'matched');
  assert.equal(items[0].type.id, 1);
  assert.equal(items[0].amount, 0);
  assert.equal(items[1].type.id, 2);
  assert.equal(items[1].amount, 800000);
  assert.equal(items[2].type.id, 3);
});

test('current payment is applied to cart lines in order', () => {
  const ctx = load();
  assert.deepEqual(ctx._splitPurchasePayments([800000, 500000, 300000], 1000000), [800000, 200000, 0]);
  assert.deepEqual(ctx._splitPurchasePayments([800000, 500000], 2000000), [800000, 1200000]);
  assert.deepEqual(ctx._splitPurchasePayments([], 1000), []);
});
