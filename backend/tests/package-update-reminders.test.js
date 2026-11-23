const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

const sandbox = {
  _db: { packages: [], package_types: [], reminders: [], students: [], service_type_aliases: [] },
  _ALL_CURRENCIES: ['تومان'],
  _enqueueDurableBusinessDelta() {},
  _save() {},
  _nextId: (() => { let n = 100; return () => ++n; })(),
  _isTomanCurrency(v) { return !v || String(v) === 'تومان'; },
  _moneyCurrency(v) { return v || 'تومان'; },
  _packageQuantity(p) { return Number(p?.quantity) || 1; },
};
vm.createContext(sandbox);

for (const name of [
  '_resolvePackageType',
  '_serviceLabelKey',
  '_serviceMergeKey',
  '_jalaliParse',
  '_jalaliKey',
  '_packagePaymentDueDate',
  '_packageDefersUntilDue',
  '_packageDeferPersist',
  '_packageQtyPersist',
  '_packageQuantity',
  '_isTomanCurrency',
  '_moneyCurrency',
  '_formatJalali',
  '_todayJalali',
  '_coercePackageTypeId',
  '_packageSnapshotPaymentSchedule',
  '_packagePaymentScheduleChanged',
  '_packagesSameServiceChain',
  '_hasNewerPackageSameServiceChain',
  '_paymentReminderTitle',
  '_patchPackageReminderMetadata',
  '_packageReminderSuppressed',
  '_removePackageReminder',
  '_syncPackageReminder',
  '_packagesUpdateRow',
]) {
  vm.runInContext(extractFunction(appSource, name), sandbox);
}
sandbox._todayJalali = () => [1405, 6, 15];
sandbox._formatJalali = (y, m, d) => `${y}/${m}/${d}`;

function baseWorkspace() {
  return {
    package_types: [{ id: 43, label: 'منیجر', color: '#7c6af7', key: 'mgr' }],
    packages: [{
      id: 10,
      student_id: 1,
      type_id: '43',
      total_amount: 500000,
      initial_cost: 0,
      repeat_months: 0,
      payment_due_date: '',
      start_date: '1404/01/01',
      note: '',
      created_at: '2024-01-01T00:00:00.000Z',
    }],
    reminders: [],
    students: [{ id: 1, name: 'تست', lname: '' }],
    service_type_aliases: [],
  };
}

test('update with only type_id does not create a payment reminder', () => {
  assert.match(appSource, /_packagesUpdateRow/);
  assert.match(appSource, /_patchPackageReminderMetadata/);
  sandbox._db = baseWorkspace();
  const before = sandbox._db.reminders.length;
  sandbox._packagesUpdateRow({ id: 10, type_id: 43 });
  assert.equal(sandbox._db.reminders.length, before);
  assert.equal(sandbox._db.packages[0].type_id, 43);
});

test('update only type_id refreshes title on existing reminder', () => {
  sandbox._db = baseWorkspace();
  sandbox._db.package_types.push({ id: 50, label: 'ادمین', color: '#888', key: 'adm' });
  sandbox._db.reminders.push({
    id: 5,
    student_id: 1,
    package_id: 10,
    title: 'سررسید پرداخت:',
    due_date_jalali: '1405/07/01',
    repeat_months: 0,
    amount: 500000,
    done: false,
    notified_levels: [],
  });
  sandbox._packagesUpdateRow({ id: 10, type_id: 50 });
  assert.equal(sandbox._db.reminders.length, 1);
  assert.equal(sandbox._db.reminders[0].title, 'سررسید پرداخت: ادمین');
});

test('update payment schedule still syncs reminder fields', () => {
  sandbox._db = baseWorkspace();
  sandbox._db.packages[0].repeat_months = 1;
  sandbox._db.packages[0].payment_due_date = '1405/07/01';
  sandbox._packagesUpdateRow({
    id: 10,
    payment_due_date: '1405/08/01',
    total_amount: 600000,
    repeat_months: 1,
  });
  assert.equal(sandbox._db.reminders.length, 1);
  const rem = sandbox._db.reminders[0];
  assert.equal(rem.package_id, 10);
  assert.equal(rem.amount, 600000);
  assert.equal(rem.due_date_jalali, '1405/08/01');
});

test('string type_id "43" builds reminder title سررسید پرداخت: منیجر', () => {
  sandbox._db = baseWorkspace();
  assert.equal(sandbox._paymentReminderTitle(sandbox._db.packages[0], null), 'سررسید پرداخت: منیجر');
  sandbox._packagesUpdateRow({
    id: 10,
    payment_due_date: '1405/07/01',
    total_amount: 500000,
    repeat_months: 1,
  });
  assert.equal(sandbox._db.reminders[0].title, 'سررسید پرداخت: منیجر');
});

test('older package in repeat chain does not get a new reminder when newer sale exists', () => {
  sandbox._db = baseWorkspace();
  sandbox._db.packages[0].repeat_months = 2;
  sandbox._db.packages[0].payment_due_date = '1404/06/01';
  sandbox._db.packages.push({
    id: 20,
    student_id: 1,
    type_id: 43,
    total_amount: 500000,
    initial_cost: 0,
    repeat_months: 2,
    payment_due_date: '1405/08/01',
    start_date: '1405/07/01',
    note: 'از یادآوری پرداخت',
    created_at: '2025-01-01T00:00:00.000Z',
  });
  sandbox._db.reminders.push({
    id: 3,
    student_id: 1,
    package_id: 20,
    title: 'سررسید پرداخت: منیجر',
    due_date_jalali: '1405/08/01',
    repeat_months: 2,
    amount: 500000,
    done: false,
    notified_levels: [],
  });
  const before = sandbox._db.reminders.length;
  sandbox._packagesUpdateRow({ id: 10, type_id: 43 });
  assert.equal(sandbox._db.reminders.length, before);
  assert.ok(!sandbox._db.reminders.some(r => String(r.package_id) === '10'));
});

test('asset version tp450', () => {
  assert.match(appSource, /const TP_ASSET_V = 'tp450'/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /team-pulse-static-v450/);
  assert.match(fs.readFileSync(path.join(root, 'app.html'), 'utf8'), /app\.js\?v=tp450/);
});