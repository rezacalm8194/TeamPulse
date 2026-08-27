const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  VERSION_RETENTION,
  versionSummaryFromSerialized,
  selectRetainedVersionIds,
  ensureVersionSnapshotSchema,
  backfillVersionSummaries,
  saveVersionSnapshot,
  pruneVersionSnapshots,
  listVersionSummaries,
} = require('../utils/versionSnapshots');

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  ensureVersionSnapshotSchema(db);
  return db;
}

function payload(overrides = {}) {
  return JSON.stringify({
    todos: [{ id: 1 }, { id: 2 }, { id: 3 }],
    students: [{ id: 's1' }],
    staff: [{ id: 'st1' }, { id: 'st2' }],
    instructions: [],
    ...overrides,
  });
}

test('summary counts arrays without needing the list path to parse snapshots', () => {
  const summary = versionSummaryFromSerialized(payload());
  assert.equal(summary.todos, 3);
  assert.equal(summary.students, 1);
  assert.equal(summary.staff, 2);
  assert.equal(summary.instructions, 0);
});

test('listing versions reads summaries even after snapshot blobs are discarded', () => {
  const db = makeDb();
  const first = payload();
  assert.equal(saveVersionSnapshot(db, 'acc-1', first, { force: true }), true);
  const listed = listVersionSummaries(db, 'acc-1', 72);
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].summary, { todos: 3, students: 1, staff: 2, instructions: 0 });
  assert.equal(listed[0].size, Buffer.byteLength(first, 'utf8'));

  db.prepare("UPDATE user_data_versions SET data='not-json'").run();
  const afterCorrupt = listVersionSummaries(db, 'acc-1', 72);
  assert.deepEqual(afterCorrupt[0].summary, { todos: 3, students: 1, staff: 2, instructions: 0 });
  assert.equal(afterCorrupt[0].size, Buffer.byteLength(first, 'utf8'));
});

test('existing version rows are backfilled into the summary table once', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE user_data_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const insertVersion = db.prepare('INSERT INTO user_data_versions (account_id,data) VALUES (?,?)');
  insertVersion.run('acc-2', payload({ todos: [{ id: 9 }] }));
  insertVersion.run('acc-2', payload({ todos: [{ id: 8 }, { id: 7 }] }));
  insertVersion.run('acc-3', payload({ todos: [] }));
  ensureVersionSnapshotSchema(db);
  backfillVersionSummaries(db);
  const listed = listVersionSummaries(db, 'acc-2', 72);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].summary.todos, 2);
  assert.equal(listed[1].summary.todos, 1);
  assert.equal(listed[0].summary.students, 1);
  assert.equal(listVersionSummaries(db, 'acc-3', 72).length, 1);
});

test('identical snapshots are skipped using the stored hash, not the blob', () => {
  const db = makeDb();
  const body = payload();
  assert.equal(saveVersionSnapshot(db, 'acc-3', body, { force: true }), true);
  db.prepare("UPDATE user_data_versions SET data='changed-on-disk'").run();
  assert.equal(saveVersionSnapshot(db, 'acc-3', body, { force: true }), false);
  assert.equal(listVersionSummaries(db, 'acc-3', 72).length, 1);
});

test('same-hour force snapshots keep only the newest safety copies', () => {
  const db = makeDb();
  for (let i = 0; i < 8; i++) {
    saveVersionSnapshot(db, 'acc-4', payload({ todos: [{ id: i }] }), { force: true });
  }
  const versions = db.prepare('SELECT COUNT(*) AS n FROM user_data_versions WHERE account_id=?').get('acc-4').n;
  const summaries = db.prepare('SELECT COUNT(*) AS n FROM user_data_version_summaries WHERE account_id=?').get('acc-4').n;
  assert.equal(versions, VERSION_RETENTION.keepNewest);
  assert.equal(summaries, VERSION_RETENTION.keepNewest);
  assert.equal(listVersionSummaries(db, 'acc-4', 200).length, VERSION_RETENTION.keepNewest);
});

test('GFS retention keeps hourly, daily, weekly, and monthly slots', () => {
  const now = Date.parse('2026-08-27T12:00:00Z');
  const rows = [];
  let id = 1;
  for (let hour = 0; hour < 30; hour++) {
    rows.push({ id: id++, created_at: new Date(now - hour * 3600000).toISOString().replace('T', ' ').replace('Z', '') });
  }
  for (let day = 2; day <= 10; day++) {
    rows.push({ id: id++, created_at: new Date(now - day * 86400000).toISOString().replace('T', ' ').replace('Z', '') });
  }
  for (let month = 1; month <= 14; month++) {
    const date = new Date(Date.UTC(2026, 7 - month, 15, 8, 0, 0));
    rows.push({ id: id++, created_at: date.toISOString().replace('T', ' ').replace('Z', '') });
  }
  const keep = selectRetainedVersionIds(rows, now);
  assert.ok(keep.has(rows[0].id));
  assert.ok(keep.size >= 20);
  assert.ok(keep.size < rows.length);
  assert.equal(keep.has(rows[rows.length - 1].id), false);
});

test('prune deletes old snapshots and cascaded summaries', () => {
  const db = makeDb();
  const insert = db.prepare('INSERT INTO user_data_versions (account_id,data,created_at) VALUES (?,?,?)');
  const now = Date.parse('2026-08-27T12:00:00Z');
  for (let i = 0; i < 40; i++) {
    const createdAt = new Date(now - i * 3600000).toISOString().replace('T', ' ').replace('.000Z', '');
    const result = insert.run('acc-5', payload({ todos: [{ id: i }] }), createdAt);
    db.prepare(`
      INSERT INTO user_data_version_summaries (version_id,account_id,created_at,data_size,data_hash,todos,students,staff,instructions)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(result.lastInsertRowid, 'acc-5', createdAt, 10, `h${i}`, i, 0, 0, 0);
  }
  const deleted = pruneVersionSnapshots(db, 'acc-5', now);
  assert.ok(deleted > 0);
  const left = db.prepare('SELECT COUNT(*) AS n FROM user_data_versions WHERE account_id=?').get('acc-5').n;
  const summaries = db.prepare('SELECT COUNT(*) AS n FROM user_data_version_summaries WHERE account_id=?').get('acc-5').n;
  assert.equal(left, summaries);
  assert.ok(left <= 40 - deleted);
  assert.ok(left >= VERSION_RETENTION.keepNewest);
});
