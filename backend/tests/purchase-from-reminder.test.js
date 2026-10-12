const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

const finance = fs.readFileSync(path.resolve(__dirname, '../../app-finance.js'), 'utf8');
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

function loadEnsure(ctx) {
  vm.runInContext(fn(app, '_serviceLabelKey'), ctx);
  vm.runInContext(fn(app, '_serviceMergeKey'), ctx);
  vm.runInContext(fn(finance, '_packageTypeMatchesLabel'), ctx);
  vm.runInContext(fn(finance, '_ensurePackageTypeByLabel'), ctx);
}

test('reminder menu posts the same item as a sale without opening the purchase form', () => {
  assert.match(finance, /onclick="savePurchaseFromReminder\(\$\{r\.id\}\)"/);
  assert.doesNotMatch(finance, /openPurchaseFromReminder/);
  const body = fn(finance, 'savePurchaseFromReminder');
  assert.doesNotMatch(body, /openNewPurchase|openModal/);
  assert.match(body, /packages\.add/);
  assert.match(body, /completePurchase/);
  assert.match(body, /_tpPaymentsTab\('purchases'\)/);
});

test('ensure package type matches reminder titles that include سررسید پرداخت', async () => {
  const addedTypes = [];
  const ctx = vm.createContext({
    window: { api: {} },
    PKG_TYPES: [],
  });
  ctx.window = ctx;
  vm.runInContext('var PKG_TYPES = []', ctx);
  ctx.window.api = {
    packageTypes: {
      getAll: async () => [{ id: 12, label: 'ادمین اینستاگرام' }],
      add: async (p) => {
        addedTypes.push(p);
        return { id: 12, label: 'ادمین اینستاگرام' };
      },
    },
  };
  loadEnsure(ctx);
  const pt = await ctx._ensurePackageTypeByLabel('سررسید پرداخت: ادمین اینستاگرام');
  assert.equal(pt.id, 12);
  assert.equal(addedTypes.length, 0);
});

test('savePurchaseFromReminder registers sale from reminder fields then opens sales tab', async () => {
  const added = [];
  const completed = [];
  const tabs = [];
  const ctx = vm.createContext({
    window: { api: {} },
    PKG_TYPES: [],
    allStudents: [{ id: 7, name: 'فاطمه', lname: 'حسن' }],
    currentPage: 'payments',
    _paymentsTab: 'reminders',
    showToast() {},
    formatJalali() { return '1404/08/12'; },
    todayJalali() { return [1404, 8, 12]; },
    _nextFuturePaymentReminderDate() { return '1405/02/12'; },
    _tpPaymentsTab(tab) { tabs.push(tab); },
    async renderPayments() {},
    async renderReminders() {},
  });
  ctx.window = ctx;
  vm.runInContext('var PKG_TYPES = []', ctx);
  ctx.window.api = {
    reminders: {
      getAll: async () => [{
        id: 37,
        student_id: 7,
        title: 'سررسید پرداخت: ادمین اینستاگرام',
        amount: 11000000,
        repeat_months: 1,
        due_date_jalali: '1404/08/12',
        note: '',
      }],
      completePurchase: async (p) => {
        completed.push(p);
        return { ok: true };
      },
    },
    packages: {
      add: async (p) => {
        added.push(p);
        return { ok: true, id: 91 };
      },
      getByStudent: async () => [],
    },
    packageTypes: {
      getAll: async () => [{ id: 4, label: 'ادمین اینستاگرام' }],
    },
    students: { getAll: async () => ctx.allStudents },
  };
  loadEnsure(ctx);
  vm.runInContext(fn(finance, 'savePurchaseFromReminder'), ctx);
  await ctx.savePurchaseFromReminder(37);
  assert.equal(added.length, 1);
  assert.equal(added[0].student_id, 7);
  assert.equal(added[0].type_id, 4);
  assert.equal(added[0].total_amount, 11000000);
  assert.equal(added[0].current_payment, 0);
  assert.equal(added[0].skip_reminder, true);
  assert.equal(added[0].payment_due_date, '1404/08/12');
  assert.equal(completed[0].id, 37);
  assert.equal(completed[0].package_id, 91);
  assert.equal(completed[0].repeat_months, 1);
  assert.equal(completed[0].payment_due_date, '1404/08/12');
  assert.equal(tabs.join(','), 'purchases');
});
