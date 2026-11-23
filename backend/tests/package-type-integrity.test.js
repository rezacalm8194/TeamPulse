const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
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

function loadEnsure(ctx) {
  vm.runInContext(fn(app, '_serviceLabelKey'), ctx);
  vm.runInContext(fn(app, '_serviceMergeKey'), ctx);
  vm.runInContext(app.match(/const _PKG_TYPE_TITLE_PREFIX_RE[\s\S]*?function _normalizePackageTypeTitle[\s\S]*?^}/m)[0], ctx);
  vm.runInContext(fn(finance, '_packageTypeMatchesLabel'), ctx);
  vm.runInContext(fn(finance, '_ensurePackageTypeByLabel'), ctx);
  vm.runInContext(fn(finance, '_saveCyclePurchase'), ctx);
}

test('normalize reminder title strips nested package prefixes', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(app.match(/const _PKG_TYPE_TITLE_PREFIX_RE[\s\S]*?function _normalizePackageTypeTitle[\s\S]*?^}/m)[0], ctx);
  assert.equal(ctx._normalizePackageTypeTitle('تجدید پکیج: تجدید پکیج: منیجر'), 'منیجر');
  assert.equal(ctx._normalizePackageTypeTitle('سررسید پرداخت: ادمین اینستاگرام'), 'ادمین اینستاگرام');
});

test('savePurchaseFromReminder uses title when copied type_id missing from catalog', async () => {
  const added = [];
  const ctx = vm.createContext({
    window: { api: {} },
    PKG_TYPES: [],
    allStudents: [{ id: 3, name: 'الف', lname: 'ب' }],
    _db: { package_types: [{ id: 9, label: 'منیجر', key: 'pt9' }], service_type_aliases: [] },
    showToast() {},
    formatJalali() { return '1404/01/01'; },
    todayJalali() { return [1404, 1, 1]; },
    _nextFuturePaymentReminderDate() { return '1404/02/01'; },
    _tpPaymentsTab() {},
    async renderPayments() {},
    async renderReminders() {},
  });
  ctx.window = ctx;
  vm.runInContext('var PKG_TYPES = []', ctx);
  ctx.window.api = {
    reminders: {
      getAll: async () => [{
        id: 1, student_id: 3, package_id: 50, title: 'تجدید پکیج: منیجر', amount: 100,
        repeat_months: 0, due_date_jalali: '1404/02/01',
      }],
      completePurchase: async () => ({ ok: true }),
    },
    packages: {
      getByStudent: async () => [{ id: 50, type_id: '99', staff_id: null }],
      add: async (p) => { added.push(p); return { id: 70 }; },
    },
    packageTypes: {
      getAll: async () => [{ id: 9, label: 'منیجر' }],
      add: async (p) => ({ id: 10, ...p }),
    },
    students: { getAll: async () => ctx.allStudents },
  };
  loadEnsure(ctx);
  vm.runInContext(fn(finance, 'savePurchaseFromReminder'), ctx);
  await ctx.savePurchaseFromReminder(1);
  assert.equal(added.length, 1);
  assert.equal(String(added[0].type_id), '9');
});

test('delete package type blocked when package uses string type_id', () => {
  const ctx = {
    _db: {
      packages: [{ id: 1, student_id: 1, type_id: '7' }],
      reminders: [],
      package_types: [{ id: 7, label: 'a' }],
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fn(app, '_packageTypeHasReferences'), ctx);
  assert.match(app, /delete: \(id\)=>\{ if\(_packageTypeHasReferences/);
  assert.equal(ctx._packageTypeHasReferences(ctx._db, 7), true);
  assert.equal(ctx._packageTypeHasReferences(ctx._db, '7'), true);
});

test('mergeDuplicates reports abort when stale references remain', () => {
  assert.match(app, /aborted: true/);
  assert.match(app, /result\.aborted/);
});

test('merge removes duplicate ids on workspace load', () => {
  assert.match(app, /function _dedupePackageTypeIds/);
  assert.match(app, /_dedupePackageTypeIds\(d\)/);
  assert.match(app, /duplicate id/);
});

test('orphan package shows خدمت حذف‌شده label', () => {
  assert.match(app, /PACKAGE_TYPE_ORPHAN_LABEL = 'خدمت حذف‌شده'/);
  assert.match(app, /type_orphan: true/);
  assert.match(finance, /_purchaseTypeDisplayHtml/);
  assert.match(finance, /type_orphan/);
});

test('catalog delete requires fresh package parts', () => {
  assert.match(app, /async function deletePkgType/);
  assert.match(app, /_ensurePackageCatalogPartsFresh/);
  assert.match(finance, /svc-orphan-panel/);
});

test('relink orphan buttons use single-quoted onclick args not JSON.stringify', () => {
  assert.match(finance, /openRelinkOrphanPackageType\('\$\{_tpOnclickStr\(g\.type_id\)\}'\)/);
  assert.match(finance, /confirmRelinkOrphanPackageType\('\$\{_tpOnclickStr\(fromTypeId\)\}'\)/);
  assert.doesNotMatch(finance, /openRelinkOrphanPackageType\(\$\{JSON\.stringify/);
  const ctx = vm.createContext({
    escapeHtml(s) { return String(s); },
    _tpOnclickStr(v) { return String(v ?? '').replace(/'/g, '&#39;'); },
  });
  const typeId = '38';
  const html = `<button onclick="openRelinkOrphanPackageType('${ctx._tpOnclickStr(typeId)}')">`;
  assert.match(html, /onclick="openRelinkOrphanPackageType\('38'\)"/);
});

test('orphan groups list alias-only missing catalog types', () => {
  assert.match(app, /function _packageTypeNeedsCatalogRelink/);
  assert.match(app, /ادغام قدیمی/);
  const ctx = {
    _db: {
      package_types: [{ id: 10, label: 'کاننیکال', key: 'pt10' }],
      packages: [{ id: 1, student_id: 1, type_id: '38', note: '' }],
      students: [{ id: 1, name: 'علی', lname: 'رضا' }],
      service_type_aliases: [{ id: '38', merged_into_id: '10' }],
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fn(app, '_resolvePackageType'), ctx);
  vm.runInContext(fn(app, '_packageTypeNeedsCatalogRelink'), ctx);
  vm.runInContext(fn(app, '_orphanPackageTypeGroups'), ctx);
  const groups = ctx._orphanPackageTypeGroups();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type_id, '38');
  assert.match(groups[0].aliasHint, /نمایش فعلی: کاننیکال از روی ادغام قدیمی/);
});

test('asset version tp447', () => {
  assert.match(app, /const TP_ASSET_V = 'tp447'/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /team-pulse-static-v447/);
  assert.match(fs.readFileSync(path.join(root, 'app.html'), 'utf8'), /app\.js\?v=tp447/);
  assert.match(fs.readFileSync(path.join(root, 'app.html'), 'utf8'), /tp402/);
});