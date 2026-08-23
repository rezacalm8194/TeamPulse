const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  ensurePushDueIndexSchema,
  upsertPushDueIndex,
  listPushScanAccountIds,
  computePushDueIndex,
  jalaliToUTC,
  iranNineAmUtc,
  iranTodayParts,
} = require('../utils/pushDueIndex');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE user_data (
      account_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      data_etag TEXT,
      updated_at TEXT
    );
    CREATE TABLE push_subscriptions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      subscription TEXT NOT NULL
    );
    CREATE TABLE push_deliveries (
      delivery_key TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL
    );
  `);
  ensurePushDueIndexSchema(db);
  return db;
}

function seedAccount(db, id, { active = 1, subscribed = true, etag = 'etag-1' } = {}) {
  db.prepare('INSERT INTO accounts (id, is_active) VALUES (?, ?)').run(id, active);
  db.prepare('INSERT INTO user_data (account_id, data, data_etag) VALUES (?, ?, ?)').run(id, '{}', etag);
  if (subscribed) {
    db.prepare('INSERT INTO push_subscriptions (id, account_id, endpoint, subscription) VALUES (?, ?, ?, ?)')
      .run(`sub-${id}`, id, `https://push/${id}`, '{}');
  }
}

test('idle subscribed accounts are not scanned every minute', () => {
  const db = makeDb();
  seedAccount(db, 'idle');
  seedAccount(db, 'due');
  seedAccount(db, 'nosub', { subscribed: false });
  seedAccount(db, 'inactive', { active: 0 });
  const now = new Date('2026-08-23T12:00:00.000Z');
  upsertPushDueIndex(db, 'idle', 'etag-1', { nextTimedMs: now.getTime() + 60 * 60 * 1000, nextDailyMs: now.getTime() + 24 * 60 * 60 * 1000 });
  upsertPushDueIndex(db, 'due', 'etag-1', { nextTimedMs: now.getTime() - 1000, nextDailyMs: null });
  upsertPushDueIndex(db, 'nosub', 'etag-1', { nextTimedMs: now.getTime() - 1000, nextDailyMs: null });
  upsertPushDueIndex(db, 'inactive', 'etag-1', { nextTimedMs: now.getTime() - 1000, nextDailyMs: null });

  assert.deepEqual(listPushScanAccountIds(db, now), ['due']);
});

test('etag changes wake the account even when the next due is in the future', () => {
  const db = makeDb();
  seedAccount(db, 'changed', { etag: 'new-etag' });
  const now = new Date('2026-08-23T12:00:00.000Z');
  upsertPushDueIndex(db, 'changed', 'old-etag', { nextTimedMs: now.getTime() + 86_400_000, nextDailyMs: null });
  assert.deepEqual(listPushScanAccountIds(db, now), ['changed']);
});

test('unindexed subscribed accounts are backfilled in small batches', () => {
  const db = makeDb();
  for (let i = 0; i < 5; i++) seedAccount(db, `u${i}`);
  const now = new Date('2026-08-23T12:00:00.000Z');
  const ids = listPushScanAccountIds(db, now, { maxUnindexed: 2 });
  assert.equal(ids.length, 2);
});

test('daily reminders wait until 09:00 Iran and then become due', () => {
  const nowBeforeNine = new Date('2026-08-23T05:00:00.000Z'); // 08:30 Iran
  const today = iranTodayParts(nowBeforeNine);
  const nine = iranNineAmUtc(today.gy, today.gm, today.gd);
  const schedule = computePushDueIndex('acc', {
    reminders: [{ id: 1, due_date_jalali: '1405/06/01', done: false }],
  }, nowBeforeNine, new Set());
  assert.equal(schedule.nextDailyMs, nine.getTime());
  assert.ok(schedule.nextDailyMs > nowBeforeNine.getTime());

  const nowAfterNine = new Date('2026-08-23T06:00:00.000Z'); // 09:30 Iran
  assert.ok(schedule.nextDailyMs <= nowAfterNine.getTime());
});

test('timed todo index uses remind_min and skips already delivered keys', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');
  const scheduled = '1405/06/01';
  const time = '16:00';
  const remindMin = 30;
  const notifAt = jalaliToUTC(scheduled, time).getTime() - remindMin * 60000;
  assert.equal(notifAt, now.getTime());

  const open = computePushDueIndex('acc', {
    todos: [{ id: 9, title: 'call', scheduled_date: scheduled, time, remind_min: remindMin }],
  }, now, new Set());
  assert.equal(open.nextTimedMs, notifAt);

  const delivered = computePushDueIndex('acc', {
    todos: [{ id: 9, title: 'call', scheduled_date: scheduled, time, remind_min: remindMin }],
  }, now, new Set(['todo:acc:9:1405/06/01:16:00:30']));
  assert.equal(delivered.nextTimedMs, null);
});
