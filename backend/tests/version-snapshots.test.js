const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  MAX_VERSIONS_PER_WORKSPACE,
  versionSummaryFromSerialized,
  ensureVersionSnapshotSchema,
  saveVersionSnapshot,
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

test('retention still caps stored versions and cascaded summaries', () => {
  const db = makeDb();
  for (let i = 0; i < MAX_VERSIONS_PER_WORKSPACE + 5; i++) {
    saveVersionSnapshot(db, 'acc-4', payload({ todos: [{ id: i }] }), { force: true });
  }
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM user_data_versions WHERE account_id=?').get('acc-4').n,
    MAX_VERSIONS_PER_WORKSPACE
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM user_data_version_summaries WHERE account_id=?').get('acc-4').n,
    MAX_VERSIONS_PER_WORKSPACE
  );
  assert.equal(listVersionSummaries(db, 'acc-4', 200).length, MAX_VERSIONS_PER_WORKSPACE);
});
