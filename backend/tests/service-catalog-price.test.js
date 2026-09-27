const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
const finance = fs.readFileSync(path.resolve(__dirname, '../../app-finance.js'), 'utf8');

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

test('sales header exposes the services and products catalog', () => {
  assert.match(finance, /openServiceProductsCatalog\(\)/);
  assert.match(finance, /خدمات و محصولات/);
  assert.match(finance, /saveServiceProductPrice/);
  assert.match(finance, /saveServiceProductLabel/);
  assert.match(finance, /saveServiceProductUnit/);
  assert.match(finance, /کیلو/);
  assert.match(finance, /سفارشی/);
  assert.match(app, /openServiceProductsCatalog/);
});

test('package type price and unit are stored and reused', () => {
  const db = {
    package_types: [{ id: 1, key: 'pt1', label: 'پخت پیک گوسفندی', color: '#f87171', price: 0 }],
    packages: [],
  };
  const context = vm.createContext({
    _db: db,
    _P: Promise.resolve.bind(Promise),
    _save() {},
    _forceNextServerSync() {},
    _nextId() { return 2; },
    _serviceMergeKey(label) { return String(label || '').trim(); },
    _packageTypesList() { return db.package_types; },
    document: { getElementById() { return null; } },
  });
  vm.runInContext(fn(app, '_pkgTypePrice'), context);
  vm.runInContext(fn(app, 'packageTypeDefaultPrice'), context);
  vm.runInContext(fn(app, '_pkgTypeUnitKind'), context);
  vm.runInContext(fn(app, '_pkgTypeUnitLabel'), context);
  vm.runInContext(fn(app, '_pkgTypeUnitHint'), context);
  vm.runInContext(fn(app, '_pkgTypeUnitPatch'), context);
  context._mergeDuplicatePackageTypes = () => ({ merged: 0, reassigned: 0 });
  const start = app.indexOf('  packageTypes: {');
  const end = app.indexOf('\n  families:', start);
  context.api = vm.runInContext('({' + app.slice(start, end) + '})', context).packageTypes;
  return context.api.update({ id: 1, price: '2500000', unit: 'kg', label: 'پخت پیک گوسفندی' }).then(() => {
    assert.equal(db.package_types[0].price, 2500000);
    assert.equal(db.package_types[0].unit, 'kg');
    assert.equal(db.package_types[0].label, 'پخت پیک گوسفندی');
    assert.equal(context.packageTypeDefaultPrice(1), 2500000);
    assert.equal(context._pkgTypeUnitLabel(db.package_types[0]), 'کیلو');
    assert.equal(context._pkgTypeUnitHint(db.package_types[0]), 'تومان / کیلو');
    assert.equal(context.packageTypeDefaultPrice(99), 0);
  }).then(() => context.api.update({ id: 1, unit: 'custom', unit_label: 'بسته' })).then(() => {
    assert.equal(db.package_types[0].unit, 'custom');
    assert.equal(db.package_types[0].unit_label, 'بسته');
    assert.equal(context._pkgTypeUnitLabel(db.package_types[0]), 'بسته');
  });
});
