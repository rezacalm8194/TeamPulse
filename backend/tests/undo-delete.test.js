// Undo after delete: the delete is applied locally at once but not sent to
// the server during the undo window. «بازگردانی» must put back exactly the
// removed rows (same position), drop only the tombstones / queued delete ops
// this delete added, and never touch another workspace's data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const j = x => JSON.parse(JSON.stringify(x)); // values from the vm realm

const root = path.resolve(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const app = read('app.js');
const start = app.indexOf('// ── Undo after delete');
const end = app.indexOf('function showToast(', start);
const undoSrc = app.slice(start, end);

function makeEnv(db) {
  const timers = [];
  const toasts = [];
  let undoClick = null;
  const queue = { list: [] };
  const el = () => ({
    className: '', style: {}, classList: { add() {} }, setAttribute() {}, append() {}, appendChild() {}, remove() {},
    addEventListener(type, fn) { if (type === 'click') undoClick = fn; },
  });
  const ctx = {
    window: {}, _db: db, Date, Set, Map, Object, Array, String, Number, Math, console,
    document: { getElementById: () => null, createElement: el, body: { appendChild() {} }, querySelectorAll: () => [] },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    showToast: (m, t) => toasts.push([m, t]),
    renderPage: async () => {},
    _save: () => { ctx.saves = (ctx.saves || 0) + 1; },
    _readDurableBusinessDeltaQueue: () => queue.list.slice(),
    _writeDurableBusinessDeltaQueue: l => { queue.list = l.slice(); },
    _ensurePendingServerSync: () => { ctx.syncs = (ctx.syncs || 0) + 1; },
  };
  ctx.window._activeDBKey = 'ws1';
  vm.createContext(ctx);
  vm.runInContext(undoSrc + '\nthis._tpUndoableDelete=_tpUndoableDelete;this._tpFlushPendingUndos=_tpFlushPendingUndos;', ctx);
  const fire = async () => { for (const t of timers.splice(0)) await t.fn(); };
  return { ctx, timers, toasts, queue, clickUndo: async () => { await undoClick(); await new Promise(r => setImmediate(r)); }, fire };
}

function paymentDb() {
  return {
    payments: [{ id: 1, amount: 100 }, { id: 2, amount: 200 }, { id: 3, amount: 300 }],
    _deletedItems: { payments: { 9: 'old' } },
  };
}

function deletePayment(env, id) {
  const { ctx, queue } = env;
  return ctx._tpUndoableDelete({
    label: 'پرداخت حذف شد',
    collections: ['payments'],
    run: () => {
      ctx._db.payments = ctx._db.payments.filter(p => p.id !== id);
      ctx._db._deletedItems.payments[id] = 'now';
      queue.list.push({ collection: 'payments', id: String(id), operation: 'delete' });
    },
  });
}

test('undo restores the row at its original position and clears only our tombstone and queued delete', async () => {
  const env = makeEnv(paymentDb());
  env.queue.list.push({ collection: 'payments', id: '1', operation: 'upsert' });
  await deletePayment(env, 2);
  assert.deepEqual(j(env.ctx._db.payments.map(p => p.id)), [1, 3]);
  assert.ok(env.ctx.window._tpSyncHoldUntil > Date.now(), 'server sync is held during the window');
  await env.clickUndo();
  assert.deepEqual(j(env.ctx._db.payments.map(p => p.id)), [1, 2, 3]);
  assert.deepEqual(Object.keys(env.ctx._db._deletedItems.payments), ['9']);
  assert.deepEqual(j(env.queue.list), [{ collection: 'payments', id: '1', operation: 'upsert' }]);
  assert.equal(env.ctx.window._tpSyncHoldUntil, 0);
});

test('without undo the delete stays and the deferred commit runs once', async () => {
  const env = makeEnv(paymentDb());
  let commits = 0;
  await env.ctx._tpUndoableDelete({
    collections: ['payments'],
    run: () => { env.ctx._db.payments = env.ctx._db.payments.filter(p => p.id !== 1); },
    commit: () => { commits++; },
  });
  await env.fire();
  await env.fire();
  assert.equal(commits, 1);
  assert.deepEqual(j(env.ctx._db.payments.map(p => p.id)), [2, 3]);
  assert.equal(env.ctx.window._tpSyncHoldUntil, 0);
  assert.ok(env.ctx.syncs >= 1, 'sync is scheduled after the window');
});

test('undo keeps edits and additions made during the window', async () => {
  const env = makeEnv(paymentDb());
  await deletePayment(env, 2);
  env.ctx._db.payments[0].amount = 150;
  env.ctx._db.payments.push({ id: 4, amount: 400 });
  await env.clickUndo();
  assert.deepEqual(j(env.ctx._db.payments.map(p => [p.id, p.amount])), [[1, 150], [2, 200], [3, 300], [4, 400]]);
});

test('undo never writes into another workspace', async () => {
  const env = makeEnv(paymentDb());
  await deletePayment(env, 2);
  const other = { payments: [{ id: 50 }], _deletedItems: {} };
  env.ctx._db = other;
  env.ctx.window._activeDBKey = 'ws2';
  await env.clickUndo();
  assert.deepEqual(j(env.ctx._db.payments.map(p => p.id)), [50]);
});

test('flushing pending undos (sign-out / workspace switch) commits them', async () => {
  const env = makeEnv(paymentDb());
  let commits = 0;
  await env.ctx._tpUndoableDelete({
    collections: ['payments'],
    run: () => { env.ctx._db.payments = env.ctx._db.payments.filter(p => p.id !== 3); },
    commit: () => { commits++; },
  });
  assert.equal(await env.ctx._tpFlushPendingUndos(), 1);
  assert.equal(commits, 1);
  assert.equal(env.ctx.window._tpSyncHoldUntil, 0);
  await env.clickUndo();
  assert.deepEqual(j(env.ctx._db.payments.map(p => p.id)), [1, 2], 'undo after flush does nothing');
});

test('server sync is held while an undo window is open; sign-out and workspace switch flush first', () => {
  assert.match(app, /async function _syncToServer\(conflictAttempt = 0\) \{[\s\S]{0,400}_tpSyncHoldUntil[\s\S]{0,200}return null;/);
  assert.match(app, /async signOut\(\) \{\s*if \(await _tpFlushPendingUndos\(\)\)/);
  assert.match(app, /if \(await _tpFlushPendingUndos\(\)\) \{ try \{ await _syncToServer\(\); \} catch \(_\) \{\} \}\s*_setCurrentAccountId\(id\);/);
});

test('important deletes use undo', () => {
  const finance = read('app-finance.js');
  const extra = read('app-extra.js');
  const todos = read('app-todos.js');
  assert.match(app, /async function deleteStudent\(id\) \{[\s\S]{0,300}await tpConfirm[\s\S]{0,200}_tpUndoableDelete\(/);
  assert.match(finance, /async function deletePayment\(id, context\) \{[\s\S]{0,600}_tpUndoableDelete\(/);
  assert.match(finance, /async function deletePackage\(id\) \{[\s\S]{0,300}_tpUndoableDelete\(/);
  assert.match(extra, /async function deleteExpense\(id\) \{[\s\S]{0,700}_tpUndoableDelete\([\s\S]{0,700}commit:async\(\)=>\{ try\{await _IDB\.deleteMany\(receiptIds\)/);
  assert.match(todos, /_tpUndoableDelete\(\{\s*label: 'کار حذف شد'/);
});
