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
  vm.runInContext(fn(finance, '_saveCyclePurchase'), ctx);
  // tp448: renewal opens a short amount confirm before saving.
  ctx.modals = [];
  ctx.openModal = (title, body, actions) => ctx.modals.push({ title, body, actions });
  ctx.closeModal = () => {};
  ctx.fmt = n => String(n);
  ctx.fa = n => String(n);
  ctx.escapeHtml = v => String(v);
  ctx.document = {
    getElementById(id) {
      if (id === 'cyc-amount') return { value: String(ctx._amountOverride ?? ctx._cyclePurchaseDraft?.amount ?? '') };
      if (id === 'cyc-carry') return { checked: ctx._carry !== false };
      return null;
    },
  };
  vm.runInContext('var _cyclePurchaseDraft = null;', ctx);
  vm.runInContext(fn(finance, '_openCyclePurchaseConfirm'), ctx);
  vm.runInContext(fn(finance, 'confirmCyclePurchase'), ctx);
}

test('reminder menu posts the same item as a sale without opening the purchase form', () => {
  assert.match(finance, /onclick="savePurchaseFromReminder\(\$\{r\.id\}\)"/);
  assert.match(finance, /onclick="savePurchaseFromSale\(\$\{p\.id\}\)"/);
  assert.doesNotMatch(finance, /openPurchaseFromReminder/);
  const body = fn(finance, '_saveCyclePurchase');
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
  assert.equal(added.length, 0, 'nothing is saved before the amount is confirmed');
  assert.equal(ctx.modals.length, 1);
  await ctx.confirmCyclePurchase();
  assert.equal(completed[0].next_amount, undefined, 'unchanged amount does not touch the reminder');
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

test('savePurchaseFromSale clones a repeating sale for the current cycle', async () => {
  const added = [];
  const completed = [];
  const tabs = [];
  const ctx = vm.createContext({
    window: { api: {} },
    PKG_TYPES: [],
    allStudents: [{ id: 9, name: 'مریم', lname: 'اصغریانیان' }],
    currentPage: 'payments',
    _paymentsTab: 'purchases',
    showToast() {},
    formatJalali() { return '1405/07/20'; },
    todayJalali() { return [1405, 7, 20]; },
    jalaliKey(s) { return String(s || '').replace(/\D/g, ''); },
    _nextFuturePaymentReminderDate() { return '1405/08/20'; },
    _isPaymentReminder() { return true; },
    _tpPaymentsTab(tab) { tabs.push(tab); },
    async renderPayments() {},
    async renderReminders() {},
  });
  ctx.window = ctx;
  vm.runInContext('var PKG_TYPES = []', ctx);
  ctx.window.api = {
    packages: {
      getAll: async () => [{
        id: 55,
        student_id: 9,
        type_id: 8,
        staff_id: 3,
        total_amount: 9000000,
        repeat_months: 1,
        start_date: '1405/06/20',
        payment_due_date: '1405/07/20',
        note: 'استوری نویسی',
      }],
      add: async (p) => {
        added.push(p);
        return { ok: true, id: 101 };
      },
    },
    reminders: {
      getAll: async () => [{
        id: 12,
        package_id: 55,
        student_id: 9,
        due_date_jalali: '1405/07/20',
        done: false,
      }],
      completePurchase: async (p) => {
        completed.push(p);
        return { ok: true };
      },
    },
  };
  loadEnsure(ctx);
  vm.runInContext(fn(finance, 'savePurchaseFromSale'), ctx);
  await ctx.savePurchaseFromSale(55);
  await ctx.confirmCyclePurchase();
  assert.equal(added.length, 1);
  assert.equal(added[0].student_id, 9);
  assert.equal(added[0].type_id, 8);
  assert.equal(added[0].staff_id, 3);
  assert.equal(added[0].total_amount, 9000000);
  assert.equal(added[0].date, '1405/07/20');
  assert.equal(added[0].payment_due_date, '1405/07/20');
  assert.equal(completed[0].id, 12);
  assert.equal(completed[0].package_id, 101);
  assert.equal(tabs.join(','), 'purchases');
});

test('raised renewal price is saved for this sale and carried to the reminder', async () => {
  const added = [];
  const completed = [];
  const ctx = vm.createContext({
    window: {}, allStudents: [{ id: 7 }], currentPage: 'payments', showToast() {},
    formatJalali() { return '1405/09/02'; }, todayJalali() { return [1405, 9, 2]; },
    _nextFuturePaymentReminderDate() { return '1405/10/02'; }, _tpPaymentsTab() {},
  });
  ctx.window = ctx;
  vm.runInContext('var PKG_TYPES = []', ctx);
  ctx.window.api = {
    reminders: {
      getAll: async () => [{ id: 5, student_id: 7, title: 'سایت', amount: 6000000, repeat_months: 1, due_date_jalali: '1405/09/02', note: '' }],
      completePurchase: async (p) => { completed.push(p); return { ok: true }; },
    },
    packages: { add: async (p) => { added.push(p); return { ok: true, id: 70 }; }, getByStudent: async () => [] },
    packageTypes: { getAll: async () => [{ id: 2, label: 'سایت' }] },
    students: { getAll: async () => ctx.allStudents },
  };
  loadEnsure(ctx);
  vm.runInContext(fn(finance, 'savePurchaseFromReminder'), ctx);
  await ctx.savePurchaseFromReminder(5);
  ctx._amountOverride = 7500000;
  await ctx.confirmCyclePurchase();
  assert.equal(added[0].total_amount, 7500000);
  assert.equal(completed[0].next_amount, 7500000);

  added.length = 0; completed.length = 0;
  await ctx.savePurchaseFromReminder(5);
  ctx._carry = false;
  await ctx.confirmCyclePurchase();
  assert.equal(added[0].total_amount, 7500000);
  assert.equal(completed[0].next_amount, undefined, 'one-off price leaves the reminder alone');
});
