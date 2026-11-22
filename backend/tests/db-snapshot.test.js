const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SNAPSHOT_FILE,
  META_FILE,
  tehranParts,
  writeDbSnapshot,
  startNightlyDbSnapshot,
} = require('../utils/dbSnapshot');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tp-snapshot-'));
}

// Fake db whose backup() just writes a file, so scheduling logic is testable
// without native modules.
function fakeDb({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async backup(dest) {
      calls.push(dest);
      if (fail) throw new Error('disk full');
      fs.writeFileSync(dest, 'snapshot-' + calls.length);
    },
  };
}

// 2026-11-22 23:40 Tehran == 20:10 UTC.
const AT_2340_TEHRAN = Date.UTC(2026, 10, 22, 20, 10);
const AT_2200_TEHRAN = Date.UTC(2026, 10, 22, 18, 30);
const NEXT_DAY_2335_TEHRAN = Date.UTC(2026, 10, 23, 20, 5);

test('tehranParts uses fixed UTC+03:30', () => {
  assert.deepEqual(tehranParts(AT_2340_TEHRAN), { dateKey: '2026-11-22', minutes: 23 * 60 + 40 });
  // 21:00 UTC is already the next day in Tehran (00:30).
  assert.equal(tehranParts(Date.UTC(2026, 10, 22, 21, 0)).dateKey, '2026-11-23');
});

test('nightly snapshot runs once inside the window and survives restart', async () => {
  const dir = tmpDir();
  let clock = AT_2200_TEHRAN;
  const db = fakeDb();
  const job = startNightlyDbSnapshot(db, { dir, now: () => clock, intervalMs: 1e9 });
  try {
    assert.equal(await job.tick(), false, 'before 23:30 nothing happens');
    clock = AT_2340_TEHRAN;
    assert.equal(await job.tick(), true);
    assert.equal(await job.tick(), false, 'only once per night');
    assert.equal(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'), 'snapshot-1');
    assert.equal(fs.existsSync(path.join(dir, SNAPSHOT_FILE + '.tmp')), false);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf8'));
    assert.equal(meta.tehran_date, '2026-11-22');
  } finally { job.stop(); }

  // Process restarts the same night: must not take a second copy.
  const restarted = startNightlyDbSnapshot(db, { dir, now: () => clock, intervalMs: 1e9 });
  try {
    assert.equal(await restarted.tick(), false);
    clock = NEXT_DAY_2335_TEHRAN;
    assert.equal(await restarted.tick(), true);
    assert.equal(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'), 'snapshot-2');
  } finally { restarted.stop(); }
});

test('failed snapshot keeps the previous copy, cleans temp file and retries', async () => {
  const dir = tmpDir();
  await writeDbSnapshot(fakeDb(), dir, { now: AT_2340_TEHRAN - 86400000 });
  const previous = fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8');
  const errors = [];
  const failing = fakeDb({ fail: true });
  const job = startNightlyDbSnapshot(failing, {
    dir,
    now: () => AT_2340_TEHRAN,
    intervalMs: 1e9,
    logger: { info() {}, error: (event) => errors.push(event) },
  });
  try {
    assert.equal(await job.tick(), false);
    assert.deepEqual(errors, ['db_snapshot_failed']);
    assert.equal(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'), previous);
    assert.equal(fs.existsSync(path.join(dir, SNAPSHOT_FILE + '.tmp')), false);
    assert.equal(await job.tick(), false);
    assert.equal(failing.calls.length, 2, 'retries on the next tick');
  } finally { job.stop(); }
});

test('real WAL database snapshot opens and contains committed rows', async (t) => {
  let Database;
  try { Database = require('better-sqlite3'); } catch (_) { t.skip('better-sqlite3 not installed'); return; }
  const dir = tmpDir();
  const live = new Database(path.join(dir, 'live.db'));
  live.pragma('journal_mode = WAL');
  live.exec('CREATE TABLE rows(id INTEGER PRIMARY KEY, v TEXT)');
  const insert = live.prepare('INSERT INTO rows(v) VALUES (?)');
  for (let i = 0; i < 500; i++) insert.run('row-' + i);
  await writeDbSnapshot(live, path.join(dir, 'snap'));
  const copy = new Database(path.join(dir, 'snap', SNAPSHOT_FILE), { readonly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM rows').get().n, 500);
  assert.equal(copy.pragma('quick_check', { simple: true }), 'ok');
  copy.close();
  live.close();
});
