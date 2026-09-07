const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extraSource = fs.readFileSync(path.join(root, 'app-extra.js'), 'utf8');

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

test('staff reminder save uses string ids, durable delta, and the edited amount', () => {
  assert.match(appSource, /_enqueueDurableBusinessDelta\('staff_reminders'/);
  assert.match(appSource, /_db\.staff_reminders\.find\(x=>String\(x\.id\)===String\(p\.id\)\)/);
  assert.match(appSource, /function _persistStaffReminderRow\(/);
  assert.match(appSource, /function _applyDurableBusinessDeltasToLocal\(/);
  assert.match(appSource, /_LIVE_DOCUMENT_OVERLAY_KEYS/);
  assert.match(extraSource, /readCalendarDateField\('esr-date'\)/);
  assert.match(extraSource, /calendarDateFieldHtml\('esr-date'/);
  assert.match(extraSource, /fmt\(r\.amount\)/);
  assert.doesNotMatch(extraSource, /fmt\(r\.live_amount\)/);
});

test('durable staff reminder deltas restore an in-flight edit after a stale server copy arrives', () => {
  const sandbox = {
    window: {},
    _db: { staff_reminders: [] },
    localStorage: {
      _data: {},
      getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
      setItem(key, value) { this._data[key] = String(value); },
      removeItem(key) { delete this._data[key]; },
    },
    DB_KEY: 'tp_test',
    console,
  };
  sandbox.window._activeDBKey = 'tp_test';
  vm.createContext(sandbox);
  vm.runInContext('function _cloneData(v){return JSON.parse(JSON.stringify(v));}', sandbox);
  vm.runInContext(extractFunction(appSource, '_isolationItemHash'), sandbox);
  vm.runInContext(extractFunction(appSource, '_businessRowTimestamp'), sandbox);
  vm.runInContext(extractFunction(appSource, '_businessDeltaQueueKey'), sandbox);
  vm.runInContext(extractFunction(appSource, '_readDurableBusinessDeltaQueue'), sandbox);
  vm.runInContext(extractFunction(appSource, '_writeDurableBusinessDeltaQueue'), sandbox);
  vm.runInContext(extractFunction(appSource, '_enqueueDurableBusinessDelta'), sandbox);
  vm.runInContext(extractFunction(appSource, '_persistStaffReminderRow'), sandbox);
  vm.runInContext(extractFunction(appSource, '_applyDurableBusinessDeltasToLocal'), sandbox);

  sandbox._db.staff_reminders = [{
    id: '12',
    staff_id: 3,
    title: 'پرداخت حقوق',
    due_date_jalali: '1405/05/18',
    amount: 20000000,
    repeat_months: 1,
    created_at: '2026-01-01T00:00:00.000Z',
  }];

  const edited = sandbox._db.staff_reminders[0];
  edited.title = 'حقوق مرداد';
  edited.amount = 25000000;
  edited.due_date_jalali = '1405/06/01';
  edited.repeat_months = 2;
  vm.runInContext('_persistStaffReminderRow(_db.staff_reminders[0])', sandbox);

  sandbox.stale = {
    staff_reminders: [{
      id: 12,
      staff_id: 3,
      title: 'پرداخت حقوق',
      due_date_jalali: '1405/05/18',
      amount: 20000000,
      repeat_months: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    }],
  };
  const restored = vm.runInContext('_applyDurableBusinessDeltasToLocal(stale)', sandbox);
  assert.equal(restored, true);
  assert.equal(sandbox.stale.staff_reminders[0].amount, 25000000);
  assert.equal(sandbox.stale.staff_reminders[0].due_date_jalali, '1405/06/01');
  assert.equal(sandbox.stale.staff_reminders[0].title, 'حقوق مرداد');
  assert.equal(sandbox.stale.staff_reminders[0].repeat_months, 2);
  assert.ok(sandbox.stale.staff_reminders[0].updated_at);
});
