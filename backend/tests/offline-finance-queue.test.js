// Offline finance entries must survive a server merge. Before the fix, the
// durable queue kept only the last 64 entries and expenses were never queued,
// so a merge (app resume / sync conflict) dropped older offline sales and
// every offline expense.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
function grab(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  let depth = 0;
  for (let i = appSource.indexOf('{', start); i < appSource.length; i++) {
    if (appSource[i] === '{') depth++;
    else if (appSource[i] === '}' && --depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(`unclosed ${name}`);
}
function grabConst(name) {
  const m = appSource.match(new RegExp(`const ${name} = [^;]+;`));
  assert.ok(m, `missing const ${name}`);
  return m[0];
}

const HOUR = 3600e3;
function makeSandbox({ hashes = { payments: { '1': 'h' }, packages: { '1': 'h' }, expenses: { '1': 'h' } }, failWrites = false } = {}) {
  const store = {};
  const toasts = [];
  const lastSync = Date.now() - HOUR;
  const sandbox = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => {
        if (failWrites && String(v).length > 2000) throw new Error('QuotaExceededError');
        store[k] = String(v);
      },
      removeItem: k => { delete store[k]; },
    },
    window: { _lastServerSyncSavedAt: lastSync },
    console: { warn() {} },
    showToast: (msg, kind) => toasts.push([msg, kind]),
    FINANCE_NEWEST_FIRST_KEYS: ['payments', 'packages', 'expenses', 'wallet_tx'],
    _businessDeltaQueueKey: () => 'queue',
    _cloneData: x => JSON.parse(JSON.stringify(x)),
    _readServerSyncPending: () => null,
    _readServerSyncBaseline: () => ({ savedAt: lastSync }),
    _readServerSyncHashes: () => (hashes ? { collections: hashes } : null),
    _isolationItemHash: r => JSON.stringify(r),
    _businessRowTimestamp: r => Date.parse(r?.updated_at || r?.created_at || '') || 0,
    _db: {},
  };
  vm.createContext(sandbox);
  vm.runInContext([
    grabConst('_DURABLE_DELTA_FINANCE_LIMIT'),
    grabConst('_DURABLE_DELTA_OTHER_LIMIT'),
    ...['_trimDurableBusinessDeltaQueue', '_readDurableBusinessDeltaQueue', '_writeDurableBusinessDeltaQueue',
      '_enqueueDurableBusinessDelta', '_pendingBusinessDeltaIds', '_keepLocalBusinessRow'].map(grab),
  ].join('\n'), sandbox);
  return { sandbox, toasts, store };
}
const nowIso = () => new Date().toISOString();
const row = (id, extra = {}) => ({ id, created_at: nowIso(), updated_at: nowIso(), ...extra });

test('40 offline sales (80 queue entries) are all kept on merge', () => {
  const { sandbox } = makeSandbox();
  for (let id = 100; id < 140; id++) {
    sandbox._enqueueDurableBusinessDelta('packages', row(id));
    sandbox._enqueueDurableBusinessDelta('payments', row(id));
  }
  assert.equal(sandbox._readDurableBusinessDeltaQueue().length, 80);
  for (let id = 100; id < 140; id++) {
    assert.equal(sandbox._keepLocalBusinessRow(row(id), 'payments'), true, `payment ${id}`);
    assert.equal(sandbox._keepLocalBusinessRow(row(id), 'packages'), true, `package ${id}`);
  }
});

test('an offline expense or wallet row the server never saw is kept, even unqueued', () => {
  const { sandbox } = makeSandbox();
  assert.equal(sandbox._keepLocalBusinessRow(row(500), 'expenses'), true);
  assert.equal(sandbox._keepLocalBusinessRow(row(77), 'wallet_tx'), true);
});

test('a row the server already knows is not overlaid unless queued (server wins)', () => {
  const { sandbox } = makeSandbox();
  assert.equal(sandbox._keepLocalBusinessRow(row(1), 'payments'), false);
  sandbox._enqueueDurableBusinessDelta('payments', row(1, { amount: 5 }));
  assert.equal(sandbox._keepLocalBusinessRow(row(1), 'payments'), true);
});

test('without baseline hashes, rows created after the last sync are kept, older ones are not', () => {
  const { sandbox } = makeSandbox({ hashes: null });
  assert.equal(sandbox._keepLocalBusinessRow(row(9), 'expenses'), true);
  const old = new Date(Date.now() - 5 * HOUR).toISOString();
  assert.equal(sandbox._keepLocalBusinessRow({ id: 8, created_at: old, updated_at: old }, 'expenses'), false);
});

test('queue keeps up to 1000 finance entries but only 64 others', () => {
  const { sandbox } = makeSandbox();
  for (let i = 0; i < 1100; i++) sandbox._enqueueDurableBusinessDelta('payments', { id: i });
  for (let i = 0; i < 100; i++) sandbox._enqueueDurableBusinessDelta('reminders', { id: i });
  const q = sandbox._readDurableBusinessDeltaQueue();
  assert.equal(q.filter(e => e.collection === 'payments').length, 1000);
  assert.equal(q.filter(e => e.collection === 'reminders').length, 64);
  assert.equal(q.find(e => e.collection === 'payments').id, '100', 'oldest finance entries evicted first');
});

test('when storage is full, finance entries are kept and the user is warned once', () => {
  const { sandbox, toasts, store } = makeSandbox({ failWrites: true });
  for (let i = 0; i < 8; i++) sandbox._enqueueDurableBusinessDelta('payments', { id: i });
  for (let i = 0; i < 40; i++) sandbox._enqueueDurableBusinessDelta('instructions', { id: i, body: 'x'.repeat(100) });
  assert.equal(toasts.length, 1);
  const saved = JSON.parse(store.queue);
  assert.deepEqual(saved.filter(e => e.collection === 'payments').map(e => e.id), ['0', '1', '2', '3', '4', '5', '6', '7']);
});

test('expense saves are queued and never use the raw id counter', () => {
  const extra = fs.readFileSync(path.resolve(__dirname, '../../app-extra.js'), 'utf8');
  assert.doesNotMatch(extra, /_db\._nextId\.expenses\+\+/);
  assert.ok((extra.match(/_enqueueDurableBusinessDelta\(\s*'expenses'/g) || []).length >= 3);
});
