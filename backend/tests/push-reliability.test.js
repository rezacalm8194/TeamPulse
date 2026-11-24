// Regression tests for push reminders that stopped or got stuck:
// 1) habits/recurring work must keep being indexed while the app stays closed
// 2) an overdue recurring todo still gets its next occurrences
// 3) undeliverable items back off / expire instead of starving the queue
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  ensurePushDueIndexSchema,
  upsertPushDueIndex,
  computePushDueIndex,
  replacePushDueItems,
  listDuePushItems,
  listPushReindexAccountIds,
  markPushDueItemFailed,
  pruneStalePushDueItems,
  IRAN_OFFSET_MS,
} = require('../utils/pushDueIndex');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, is_active INTEGER DEFAULT 1);
    CREATE TABLE user_data (account_id TEXT PRIMARY KEY, data TEXT NOT NULL, data_etag TEXT, updated_at TEXT);
    CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, endpoint TEXT NOT NULL, subscription TEXT NOT NULL);
    CREATE TABLE push_deliveries (delivery_key TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL);
  `);
  ensurePushDueIndexSchema(db);
  return db;
}

function seed(db, id) {
  db.prepare('INSERT INTO accounts (id, is_active) VALUES (?, 1)').run(id);
  db.prepare('INSERT INTO user_data (account_id, data, data_etag) VALUES (?, ?, ?)').run(id, '{}', 'e1');
  db.prepare('INSERT INTO push_subscriptions (id, account_id, endpoint, subscription) VALUES (?, ?, ?, ?)')
    .run(`s-${id}`, id, `https://push/${id}`, '{}');
}

// Tehran wall clock → Date
const tehran = iso => new Date(Date.parse(iso + 'Z') - IRAN_OFFSET_MS);
const keysOf = schedule => schedule.items.map(item => item.deliveryKey);

test('index expires at the next Tehran midnight so idle accounts are rebuilt daily', () => {
  const now = tehran('2026-11-24T10:00:00');
  const schedule = computePushDueIndex('A', { habits: [{ id: 1, title: 'h', time: '08:00', remind_min: 15 }] }, now, new Set());
  assert.equal(schedule.validUntilMs, tehran('2026-11-25T00:01:00').getTime());

  const db = makeDb();
  seed(db, 'A');
  upsertPushDueIndex(db, 'A', 'e1', schedule);
  assert.deepEqual(listPushReindexAccountIds(db, now), [], 'unchanged data, still valid: no reload');
  assert.deepEqual(listPushReindexAccountIds(db, tehran('2026-11-25T00:02:00')), ['A'], 'after midnight: rebuilt');
});

test('legacy index rows without expiry are rebuilt once', () => {
  const db = makeDb();
  seed(db, 'L');
  upsertPushDueIndex(db, 'L', 'e1', { nextTimedMs: null, nextDailyMs: null });
  assert.deepEqual(listPushReindexAccountIds(db, new Date()), ['L']);
});

test('expired rebuilds are batched', () => {
  const db = makeDb();
  for (let i = 0; i < 5; i++) { seed(db, `x${i}`); upsertPushDueIndex(db, `x${i}`, 'e1', { validUntilMs: 1 }); }
  assert.equal(listPushReindexAccountIds(db, new Date(), { maxExpired: 2 }).length, 2);
});

test('habit reminder continues on day 3 without any data change', () => {
  const data = { habits: [{ id: 1, title: 'ورزش', time: '08:00', remind_min: 15 }] };
  // Day 3 rebuild (what the daily expiry triggers)
  const schedule = computePushDueIndex('A', data, tehran('2026-11-26T00:02:00'), new Set());
  assert.ok(keysOf(schedule).includes('habit:A:1:2026-11-26:08:00:15'));
  assert.ok(keysOf(schedule).includes('habit:A:1:2026-11-27:08:00:15'));
});

test('overdue daily todo (not ticked) is reminded today and tomorrow', () => {
  const data = { todos: [{ id: 7, title: 't', time: '09:00', remind_min: 15, repeat: 'daily', scheduled_date: '۱۴۰۵/۰۹/۰۱' }] };
  const schedule = computePushDueIndex('A', data, tehran('2026-11-24T06:00:00'), new Set()); // 1405/09/03
  assert.deepEqual(keysOf(schedule), [
    'todo:A:7:۱۴۰۵/۰۹/۰۳:09:00:15',
    'todo:A:7:۱۴۰۵/۰۹/۰۴:09:00:15',
    'todo:A:7:۱۴۰۵/۰۹/۰۵:09:00:15',
  ]);
  assert.equal(schedule.items[0].dueMs, tehran('2026-11-24T08:45:00').getTime());
  assert.equal(schedule.items[0].payload.todo.scheduled_date, '۱۴۰۵/۰۹/۰۳');
});

test('every2days / weekly / custom_weekdays / monthly follow their own rule', () => {
  const now = tehran('2026-11-24T06:00:00'); // Tue 1405/09/03
  const keys = todo => keysOf(computePushDueIndex('A', { todos: [todo] }, now, new Set()));
  const base = { id: 1, title: 't', time: '09:00', remind_min: 15 };
  // anchor 1405/09/01 (Sun): every2days → 09/03, 09/05
  assert.deepEqual(keys({ ...base, repeat: 'every2days', scheduled_date: '1405/09/01' }),
    ['todo:A:1:۱۴۰۵/۰۹/۰۳:09:00:15', 'todo:A:1:۱۴۰۵/۰۹/۰۵:09:00:15']);
  // weekly anchored on a Wednesday (1405/08/27) → Wed 1405/09/04 only
  assert.deepEqual(keys({ ...base, repeat: 'weekly', scheduled_date: '1405/08/27' }),
    ['todo:A:1:۱۴۰۵/۰۹/۰۴:09:00:15']);
  // custom weekdays tue,thu → Tue 09/03, Thu 09/05
  assert.deepEqual(keys({ ...base, repeat: 'custom_weekdays', weekdays: 'tue,thu', scheduled_date: '1405/08/20' }),
    ['todo:A:1:۱۴۰۵/۰۹/۰۳:09:00:15', 'todo:A:1:۱۴۰۵/۰۹/۰۵:09:00:15']);
  // monthly on day 4 → 1405/09/04
  assert.deepEqual(keys({ ...base, repeat: 'monthly', scheduled_date: '1405/08/04' }),
    ['todo:A:1:۱۴۰۵/۰۹/۰۴:09:00:15']);
});

test('non-recurring and future todos are unchanged; delivered occurrence is skipped', () => {
  const now = tehran('2026-11-24T06:00:00');
  const once = computePushDueIndex('A', { todos: [{ id: 2, title: 'x', time: '09:00', remind_min: 15, repeat: 'none', scheduled_date: '1405/09/01' }] }, now, new Set());
  assert.deepEqual(keysOf(once), []);
  const future = computePushDueIndex('A', { todos: [{ id: 3, title: 'x', time: '09:00', remind_min: 15, repeat: 'daily', scheduled_date: '1405/09/10' }] }, now, new Set());
  assert.deepEqual(keysOf(future), ['todo:A:3:1405/09/10:09:00:15']);
  const skip = computePushDueIndex('A', { todos: [{ id: 7, title: 't', time: '09:00', remind_min: 15, repeat: 'daily', scheduled_date: '1405/09/01' }] },
    now, new Set(['todo:A:7:۱۴۰۵/۰۹/۰۳:09:00:15']));
  assert.ok(!keysOf(skip).includes('todo:A:7:۱۴۰۵/۰۹/۰۳:09:00:15'));
});

test('undeliverable items back off so newer items are not starved', () => {
  const db = makeDb();
  seed(db, 'stuck');
  seed(db, 'fresh');
  const now = new Date('2026-11-24T10:00:00Z');
  const stuck = [];
  for (let i = 0; i < 3; i++) stuck.push({ deliveryKey: `k${i}`, kind: 'habit', dueMs: now.getTime() - 60_000 * (10 + i), payload: {} });
  replacePushDueItems(db, 'stuck', stuck);
  replacePushDueItems(db, 'fresh', [{ deliveryKey: 'new', kind: 'todo', dueMs: now.getTime() - 1000, payload: {} }]);

  // With a tiny batch the old stuck items used to win forever.
  assert.deepEqual(listDuePushItems(db, now, { limit: 3 }).map(r => r.deliveryKey), ['k2', 'k1', 'k0']);
  for (const key of ['k0', 'k1', 'k2']) markPushDueItemFailed(db, key, now);
  assert.deepEqual(listDuePushItems(db, now, { limit: 3 }).map(r => r.deliveryKey), ['new']);

  // Retried after the backoff, with growing delay.
  const later = new Date(now.getTime() + 61_000);
  assert.ok(listDuePushItems(db, later).some(r => r.deliveryKey === 'k0'));
  const second = markPushDueItemFailed(db, 'k0', later);
  assert.equal(second.attempts, 2);
  assert.equal(second.nextAttemptMs, later.getTime() + 120_000);
});

test('items older than the catch-up window are not sent and get pruned', () => {
  const db = makeDb();
  seed(db, 'A');
  const now = new Date('2026-11-24T10:00:00Z');
  replacePushDueItems(db, 'A', [
    { deliveryKey: 'old', kind: 'todo', dueMs: now.getTime() - 7 * 3600_000, payload: {} },
    { deliveryKey: 'ok', kind: 'todo', dueMs: now.getTime() - 3600_000, payload: {} },
  ]);
  assert.deepEqual(listDuePushItems(db, now).map(r => r.deliveryKey), ['ok']);
  assert.equal(pruneStalePushDueItems(db, now), 1);
});

// ── workspaces, late sends, done habits, cleanup ─────────────────────────
const { prunePushDeliveries, parseStorageKey, storageKeyFor } = require('../utils/pushDueIndex');

test('storage keys map to owner + workspace', () => {
  assert.deepEqual(parseStorageKey('u1'), { ownerId: 'u1', workspaceId: 'default' });
  assert.deepEqual(parseStorageKey('u1::workspace::acc_abcdef'), { ownerId: 'u1', workspaceId: 'acc_abcdef' });
  assert.equal(storageKeyFor('u1', 'default'), 'u1');
  assert.equal(storageKeyFor('u1', 'acc_abcdef'), 'u1::workspace::acc_abcdef');
});

test('non-default workspaces with a device are indexed and delivered', () => {
  const db = makeDb();
  seed(db, 'O');
  const ws = 'O::workspace::acc_second1';
  db.prepare('INSERT INTO user_data (account_id, data, data_etag) VALUES (?, ?, ?)').run(ws, '{}', 'w1');
  db.prepare("INSERT INTO push_subscriptions (id, account_id, endpoint, subscription, workspace_id) VALUES ('s2','O','https://push/ws','{}','acc_second1')").run();
  const now = new Date('2026-11-24T10:00:00Z');
  assert.deepEqual(listPushReindexAccountIds(db, now).sort(), ['O', ws].sort());

  upsertPushDueIndex(db, ws, 'w1', { validUntilMs: now.getTime() + 1e6 });
  upsertPushDueIndex(db, 'O', 'e1', { validUntilMs: now.getTime() + 1e6 });
  assert.deepEqual(listPushReindexAccountIds(db, now), []);
  replacePushDueItems(db, ws, [{ deliveryKey: 'todo:ws:1', kind: 'todo', dueMs: now.getTime() - 1000, payload: {} }]);
  const [item] = listDuePushItems(db, now);
  assert.equal(item.accountId, ws);
  assert.equal(item.ownerId, 'O');
  assert.equal(item.workspaceId, 'acc_second1');
});

test('workspace items wait when only another workspace has a device', () => {
  const db = makeDb();
  seed(db, 'O'); // device only in default
  const now = new Date('2026-11-24T10:00:00Z');
  replacePushDueItems(db, 'O::workspace::acc_second1', [{ deliveryKey: 'k', kind: 'todo', dueMs: now.getTime() - 1000, payload: {} }]);
  assert.deepEqual(listDuePushItems(db, now), []);
});

test('task ownership is checked against the owner, not the workspace key', () => {
  const now = tehran('2026-11-24T08:00:00');
  const data = { todos: [{ id: 1, title: 't', time: '09:00', remind_min: 15, owner_id: 'O', scheduled_date: '1405/09/03' }] };
  assert.equal(computePushDueIndex('O::workspace::acc_second1', data, now, new Set()).items.length, 1);
});

test('a reminder that is already late when first indexed is skipped (no surprise pushes after edits)', () => {
  const now = tehran('2026-11-24T10:00:00');
  const data = { habits: [{ id: 1, title: 'h', time: '08:00', remind_min: 15 }] };
  const todayKey = 'habit:A:1:2026-11-24:08:00:15';
  // No knownKeys (legacy / tests): full window, sent late.
  assert.ok(keysOf(computePushDueIndex('A', data, now, new Set())).includes(todayKey));
  // First time seen (just edited): skipped.
  assert.ok(!keysOf(computePushDueIndex('A', data, now, new Set(), { knownKeys: new Set() })).includes(todayKey));
  // Already indexed before (server was down): still caught up.
  assert.ok(keysOf(computePushDueIndex('A', data, now, new Set(), { knownKeys: new Set([todayKey]) })).includes(todayKey));
  // Slightly late (5 min) new item is still sent.
  const near = computePushDueIndex('A', data, tehran('2026-11-24T07:50:00'), new Set(), { knownKeys: new Set() });
  assert.ok(keysOf(near).includes(todayKey));
});

test('habit already ticked today gets no reminder today, but tomorrow still does', () => {
  const now = tehran('2026-11-24T06:00:00');
  const data = {
    habits: [{ id: 1, title: 'h', time: '08:00', remind_min: 15, custom_reminders: [{ id: 9, time: '20:00', date: '1405/09/03' }] }],
    habit_logs: [{ habit_id: 1, date: '۱۴۰۵/۰۹/۰۳', done: true }],
  };
  const keys = keysOf(computePushDueIndex('A', data, now, new Set()));
  assert.deepEqual(keys, ['habit:A:1:2026-11-25:08:00:15']);
});

test('delivery log keeps payment keys but drops old timed keys', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE push_deliveries (delivery_key TEXT PRIMARY KEY, account_id TEXT, kind TEXT, sent_at TEXT)");
  const ins = db.prepare('INSERT INTO push_deliveries VALUES (?,?,?,?)');
  ins.run('todo-old', 'A', 'todo', '2026-11-01 08:00:00');
  ins.run('habit-new', 'A', 'habit', '2026-11-24 08:00:00');
  ins.run('fin-old', 'A', 'financial-reminder', '2026-11-01 08:00:00');
  assert.equal(prunePushDeliveries(db, new Date('2026-11-24T10:00:00Z')), 1);
  assert.deepEqual(db.prepare('SELECT delivery_key FROM push_deliveries ORDER BY 1').all().map(r => r.delivery_key), ['fin-old', 'habit-new']);
});
