const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { diffTodos } = require('../utils/todoAudit');
const {
  HISTORICAL_SEED_MIGRATION,
  recurringEventKey,
  initTodoAuditStore,
  seedHistoricalRecurringSnapshots,
  enqueueTodoAuditEvents,
  flushPendingTodoAudits,
} = require('../utils/todoAuditStore');

function snapshot(id, rootTodoId = 17, occurrence = '1405/05/27') {
  return {
    id, recurrence_parent_id: rootTodoId, scheduled_date: occurrence,
    _snapshot: true, archived: true, done: true, status: 'completed',
    title: 'PRIVATE TITLE', note: 'PRIVATE NOTE', description: 'PRIVATE DESCRIPTION',
    report: 'PRIVATE REPORT', token: 'PRIVATE TOKEN',
  };
}

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-audit-store-'));
  const file = path.join(dir, 'test.db');
  const db = new Database(file);
  db.exec(`
    CREATE TABLE user_data (account_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE user_data_versions (id INTEGER PRIMARY KEY, account_id TEXT NOT NULL, data TEXT NOT NULL);
  `);
  initTodoAuditStore(db);
  return { db, file, dir };
}

test('recurring outbox dedupes re-sync and remove/re-add while occurrences remain distinct', () => {
  const { db, dir } = makeDb();
  try {
    const first = snapshot(1001);
    const second = snapshot(1002, 17, '1405/05/28');
    const changes = diffTodos([], [first, second]);
    enqueueTodoAuditEvents(db, 'owner::default', { requestId: 'r1', actorUserId: 'owner' }, changes);
    enqueueTodoAuditEvents(db, 'owner::default', { requestId: 'r2', actorUserId: 'owner' }, diffTodos([], [first]));
    enqueueTodoAuditEvents(db, 'owner::default', { requestId: 'r3', actorUserId: 'owner' }, diffTodos([], [first]));

    const rows = db.prepare('SELECT * FROM todo_audit_events ORDER BY entity_id').all();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row.entity_id), ['1001', '1002']);
    assert.deepEqual(rows.map(row => row.root_todo_id), ['17', '17']);
    assert.equal(rows[0].event_key, recurringEventKey('owner::default', '1001'));
    const serialized = JSON.stringify(rows);
    for (const secret of ['PRIVATE TITLE', 'PRIVATE NOTE', 'PRIVATE DESCRIPTION', 'PRIVATE REPORT', 'PRIVATE TOKEN']) {
      assert.equal(serialized.includes(secret), false);
    }
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restart keeps dedupe and pending recovery uses a stable auditEventId', async () => {
  const { db, file, dir } = makeDb();
  try {
    enqueueTodoAuditEvents(db, 'owner', { requestId: 'r1', actorUserId: 'owner' }, diffTodos([], [snapshot(845)]));
    const beforeRestart = db.prepare('SELECT id,status FROM todo_audit_events').get();
    db.close();

    const reopened = new Database(file);
    initTodoAuditStore(reopened);
    enqueueTodoAuditEvents(reopened, 'owner', { requestId: 'r2', actorUserId: 'owner' }, diffTodos([], [snapshot(845)]));
    assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM todo_audit_events').get().count, 1);
    const attempts = [];
    const failingLogger = {
      auditAsync: async (event, fields) => { attempts.push({ event, ...fields }); throw new Error('disk unavailable'); },
      error() {},
    };
    await flushPendingTodoAudits(reopened, failingLogger);
    assert.equal(reopened.prepare('SELECT status FROM todo_audit_events').get().status, 'pending');

    const successfulLogger = { auditAsync: async (event, fields) => attempts.push({ event, ...fields }), error() {} };
    await flushPendingTodoAudits(reopened, successfulLogger);
    const after = reopened.prepare('SELECT status,written_at FROM todo_audit_events').get();
    assert.equal(after.status, 'written');
    assert.ok(after.written_at);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].auditEventId, `todo-audit-${beforeRestart.id}`);
    assert.equal(attempts[1].auditEventId, attempts[0].auditEventId);
    reopened.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('historical seed covers current, retained version, and tombstone identities idempotently', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)').run('owner', JSON.stringify({
      todos: [snapshot(1001)], _todoTombstones: [845],
    }));
    db.prepare('INSERT INTO user_data_versions(account_id,data) VALUES (?,?)').run('owner', JSON.stringify({
      todos: [snapshot(900)],
    }));
    const firstStartup = seedHistoricalRecurringSnapshots(db);
    const secondStartup = seedHistoricalRecurringSnapshots(db);
    assert.deepEqual(firstStartup, { applied: true, historicalScanCount: 2 });
    assert.deepEqual(secondStartup, { applied: false, historicalScanCount: 0 });
    assert.ok(db.prepare('SELECT applied_at FROM app_migrations WHERE name=?').get(HISTORICAL_SEED_MIGRATION).applied_at);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM todo_audit_events').get().count, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todo_audit_events WHERE status='seeded'").get().count, 3);
    enqueueTodoAuditEvents(db, 'owner', { requestId: 'later' }, diffTodos([], [snapshot(845)]));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM todo_audit_events').get().count, 3);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed historical seed rolls back marker and retries safely on next startup', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)').run('owner', JSON.stringify({ todos: [snapshot(1001)] }));
    db.exec(`
      CREATE TRIGGER fail_todo_audit_seed
      BEFORE INSERT ON todo_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'simulated seed failure');
      END;
    `);
    assert.throws(() => seedHistoricalRecurringSnapshots(db), /simulated seed failure/);
    assert.equal(db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(HISTORICAL_SEED_MIGRATION), undefined);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM todo_audit_events').get().count, 0);

    db.exec('DROP TRIGGER fail_todo_audit_seed');
    const retry = seedHistoricalRecurringSnapshots(db);
    assert.deepEqual(retry, { applied: true, historicalScanCount: 2 });
    assert.ok(db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(HISTORICAL_SEED_MIGRATION));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM todo_audit_events').get().count, 1);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('marker skips historical scans while pending recovery and new snapshot dedupe continue', async () => {
  const { db, file, dir } = makeDb();
  try {
    db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)').run('owner', JSON.stringify({ todos: [snapshot(845)] }));
    assert.equal(seedHistoricalRecurringSnapshots(db).historicalScanCount, 2);
    enqueueTodoAuditEvents(db, 'owner', { requestId: 'new' }, diffTodos([], [snapshot(1002)]));
    db.close();

    const reopened = new Database(file);
    initTodoAuditStore(reopened);
    const restarts = [
      seedHistoricalRecurringSnapshots(reopened),
      seedHistoricalRecurringSnapshots(reopened),
      seedHistoricalRecurringSnapshots(reopened),
    ];
    assert.deepEqual(restarts.map(result => result.historicalScanCount), [0, 0, 0]);

    const written = [];
    await flushPendingTodoAudits(reopened, {
      auditAsync: async (event, fields) => written.push({ event, ...fields }),
      error() {},
    });
    assert.equal(written.length, 1);
    assert.equal(written[0].entityId, '1002');
    assert.equal(reopened.prepare("SELECT status FROM todo_audit_events WHERE entity_id='1002'").get().status, 'written');

    enqueueTodoAuditEvents(reopened, 'owner', { requestId: 'readd' }, diffTodos([], [snapshot(845)]));
    enqueueTodoAuditEvents(reopened, 'owner', { requestId: 'resync' }, diffTodos([], [snapshot(1002)]));
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM todo_audit_events WHERE entity_id IN ('845','1002')").get().count, 2);
    reopened.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('non-recurring complete/reopen/complete creates all legitimate transitions', () => {
  const { db, dir } = makeDb();
  try {
    const pending = { id: 55, done: false, status: 'pending' };
    const completed = { id: 55, done: true, status: 'completed' };
    const transitions = [
      diffTodos([pending], [completed]),
      diffTodos([completed], [pending]),
      diffTodos([pending], [completed]),
    ];
    transitions.forEach((changes, index) => enqueueTodoAuditEvents(db, 'owner', { requestId: `r${index}` }, changes));
    assert.deepEqual(
      db.prepare('SELECT event FROM todo_audit_events ORDER BY id').all().map(row => row.event),
      ['todo_completed', 'todo_reopened', 'todo_completed']
    );
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
