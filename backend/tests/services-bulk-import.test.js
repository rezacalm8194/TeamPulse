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

function parserContext(existing = []) {
  const sb = { PKG_TYPES: existing };
  vm.createContext(sb);
  for (const n of ['_serviceLabelKey', '_serviceMergeKey']) vm.runInContext(extractFunction(appSource, n), sb);
  for (const n of ['_svcImportNumber', '_svcImportUnit', '_svcImportHeaderMap', '_svcImportFromRows', '_svcImportSplitPaste']) {
    vm.runInContext(extractFunction(financeSource, n), sb);
  }
  return sb;
}

test('excel rows with a header map by column name and flag existing / duplicate / empty rows', () => {
  const sb = parserContext([{ id: 1, label: 'کوچینگ' }]);
  sb.rows = [
    ['واحد', 'نام محصول', 'قیمت (تومان)'],
    ['کیلو', 'قهوه عربیکا', '۱,۲۰۰,۰۰۰'],
    ['', 'کوچینگ', 75000000],
    ['بسته', 'قهوه  عربیکا', 900000],
    ['عدد', '', 5],
    ['', 'ماگ', 'رایگان'],
  ];
  const out = vm.runInContext('_svcImportFromRows(rows)', sb);
  assert.equal(out.length, 5);
  assert.deepEqual([out[0].label, out[0].price, out[0].unit, out[0].status], ['قهوه عربیکا', 1200000, 'kg', 'new']);
  assert.equal(out[1].status, 'exists');
  assert.equal(out[2].status, 'dup');
  assert.equal(out[3].status, 'invalid');
  assert.equal(out[4].price, 0);
  assert.equal(out[4].priceWarn, true);
});

test('rows without a header use name, price, unit order; custom units keep their text', () => {
  const sb = parserContext();
  sb.rows = [['ادیت ویدیو', 2500000, 'دقیقه'], ['هاست', '', '']];
  const out = vm.runInContext('_svcImportFromRows(rows)', sb);
  assert.deepEqual([out[0].unit, out[0].unit_label, out[0].price], ['custom', 'دقیقه', 2500000]);
  assert.equal(out[1].price, 0);
});

test('pasted text: tab-separated (from Excel) and «name, price» lines', () => {
  const sb = parserContext();
  sb.text = 'سئو\t۳۰۰۰۰۰۰\nطراحی لوگو، 4,500,000\nمشاوره';
  const out = vm.runInContext('_svcImportFromRows(_svcImportSplitPaste(text))', sb);
  assert.deepEqual(JSON.parse(JSON.stringify(out.map(r => [r.label, r.price]))), [['سئو', 3000000], ['طراحی لوگو', 4500000], ['مشاوره', 0]]);
});

test('addMany adds 1000 items in one save and skips or updates existing names', () => {
  const start = appSource.indexOf('addMany: (p)=>{');
  assert.notEqual(start, -1);
  const end = appSource.indexOf('\n    },', start);
  const body = appSource.slice(start + 'addMany: '.length, end + 6).replace(/,\s*$/, '');
  const sb = {
    _db: { package_types: [{ id: 1, label: 'کوچینگ', price: 0 }], _nextId: {}, _deletedItems: {} },
    saves: 0,
    _save() { sb.saves++; },
    _forceNextServerSync() {},
    _P: v => v,
  };
  vm.createContext(sb);
  for (const n of ['_serviceLabelKey', '_serviceMergeKey', '_pkgTypePrice', '_pkgTypeUnitKind', '_pkgTypeUnitPatch']) {
    vm.runInContext(extractFunction(appSource, n), sb);
  }
  sb._bumpCollectionNextId = t => Math.max(0, ...sb._db[t].map(x => x.id)) + 1;
  vm.runInContext(extractFunction(appSource, '_nextId'), sb);
  sb.items = Array.from({ length: 1000 }, (_, i) => ({ label: `محصول ${i + 1}`, price: (i + 1) * 1000, unit: 'count' }));
  sb.items.push({ label: 'کوچینگ', price: 75000000 });
  const res = vm.runInContext(`(${body})({ items, updateExisting: false })`, sb);
  assert.equal(res.added, 1000);
  assert.equal(res.skipped, 1);
  assert.equal(sb.saves, 1);
  assert.equal(sb._db.package_types.length, 1001);
  assert.equal(new Set(sb._db.package_types.map(t => t.id)).size, 1001);
  assert.equal(sb._db.package_types[0].price, 0);
  const res2 = vm.runInContext(`(${body})({ items: [{ label: 'کوچینگ', price: 80000000 }], updateExisting: true })`, sb);
  assert.equal(res2.updated, 1);
  assert.equal(sb._db.package_types[0].price, 80000000);
});

test('catalog has the bulk import entry and a search for long lists', () => {
  assert.match(financeSource, /onclick="openServicesBulkImport\(\)"/);
  assert.match(financeSource, /oninput="_filterServiceCatalog\(this\.value\)"/);
  assert.match(financeSource, /onchange="importServicesFile\(this\)"/);
});
