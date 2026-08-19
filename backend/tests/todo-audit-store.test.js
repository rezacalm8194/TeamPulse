const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { diffTodos } = require('../utils/todoAudit');
const {
  HISTORICAL_SEED_MIGRATION,
  OCCURRENCE_IDENTITY_MIGRATION,
  legacyRecurringEventKey,
  recurringEventKey,
  initTodoAuditStore,
  seedHistoricalRecurringSnapshots,
  migrateTodoAuditOccurrenceIdentityV2,
  getTodoHighWater,
  writeTodoHighWater,
  documentTodoHighWater,
  findTodoIdCollisions,
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
    assert.equal(rows[0].event_key, recurringEventKey('owner::default', '1001', '17', '1405/05/27'));
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
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
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
  const { db, dir } = makeDb();
  try {
    db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)').run('owner', JSON.stringify({ todos: [snapshot(845)] }));
    assert.equal(seedHistoricalRecurringSnapshots(db).historicalScanCount, 2);
    assert.equal(migrateTodoAuditOccurrenceIdentityV2(db).historicalScanCount, 2);
    enqueueTodoAuditEvents(db, 'owner', { requestId: 'new' }, diffTodos([], [snapshot(1002)]));

    const reopened = db;
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
    // 845 intentionally has both its preserved v1 row and its v2 occurrence row.
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM todo_audit_events WHERE entity_id IN ('845','1002')").get().count, 3);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
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

test('v2 preserves v1 rows and separates reused snapshot ids by root and occurrence', () => {
  const { db, dir } = makeDb();
  try {
    const oldOccurrence = snapshot(6626, 9, '۱۴۰۵/۰۴/۲۵');
    const newOccurrence = snapshot(6626, 9, '۱۴۰۵/۰۵/۲۷');
    db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)').run('owner', JSON.stringify({
      todos: [newOccurrence], _nextId: { todos: 6627 }, _todoTombstones: [],
    }));
    db.prepare('INSERT INTO user_data_versions(account_id,data) VALUES (?,?)').run('owner', JSON.stringify({ todos: [oldOccurrence] }));
    db.prepare(`INSERT INTO todo_audit_events
      (event_key,event,entity_id,root_todo_id,occurrence,status,storage_key)
      VALUES (?,?,?,?,?,'seeded',?)
    `).run(legacyRecurringEventKey('owner', 6626), 'todo_completed', '6626', '9', '۱۴۰۵/۰۴/۲۵', 'owner');
    db.prepare('INSERT INTO app_migrations(name) VALUES (?)').run(HISTORICAL_SEED_MIGRATION);

    const first = migrateTodoAuditOccurrenceIdentityV2(db);
    const second = migrateTodoAuditOccurrenceIdentityV2(db);
    assert.deepEqual(first, { applied: true, historicalScanCount: 2 });
    assert.deepEqual(second, { applied: false, historicalScanCount: 0 });
    assert.ok(db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(OCCURRENCE_IDENTITY_MIGRATION));
    assert.equal(db.prepare('SELECT 1 FROM todo_audit_events WHERE event_key=?').get(legacyRecurringEventKey('owner', 6626)) != null, true);
    assert.ok(db.prepare('SELECT 1 FROM todo_audit_events WHERE event_key=?').get(recurringEventKey('owner', 6626, 9, '1405/04/25')));
    assert.ok(db.prepare('SELECT 1 FROM todo_audit_events WHERE event_key=?').get(recurringEventKey('owner', 6626, 9, '1405/05/27')));
    assert.notEqual(
      recurringEventKey('owner', 6626, 9, '1405/04/25'),
      recurringEventKey('owner', 6626, 9, '1405/05/27')
    );
    assert.equal(getTodoHighWater(db, 'owner'), 6626);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v2 tombstone id-only raises high-water without suppressing a new occurrence identity', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)').run('owner', JSON.stringify({ todos: [], _todoTombstones: [6626] }));
    db.prepare('INSERT INTO app_migrations(name) VALUES (?)').run(HISTORICAL_SEED_MIGRATION);
    migrateTodoAuditOccurrenceIdentityV2(db);
    assert.equal(getTodoHighWater(db, 'owner'), 6626);
    assert.equal(db.prepare('SELECT 1 FROM todo_audit_events WHERE event_key=?').get(
      recurringEventKey('owner', 6626, 9, '1405/05/27')
    ), undefined);
    enqueueTodoAuditEvents(db, 'owner', { requestId: 'new-occurrence' }, diffTodos([], [snapshot(6626, 9, '1405/05/27')]));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todo_audit_events WHERE status='pending'").get().count, 1);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed v2 migration rolls back its marker, seeded identities, and high-water', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)').run('owner', JSON.stringify({ todos: [snapshot(6626, 9, '1405/05/27')] }));
    db.prepare('INSERT INTO app_migrations(name) VALUES (?)').run(HISTORICAL_SEED_MIGRATION);
    db.exec(`
      CREATE TRIGGER fail_v2_seed
      BEFORE INSERT ON todo_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'simulated v2 failure');
      END;
    `);
    assert.throws(() => migrateTodoAuditOccurrenceIdentityV2(db), /simulated v2 failure/);
    assert.equal(db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(OCCURRENCE_IDENTITY_MIGRATION), undefined);
    assert.equal(getTodoHighWater(db, 'owner'), 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM todo_audit_events').get().count, 0);
    db.exec('DROP TRIGGER fail_v2_seed');
    assert.equal(migrateTodoAuditOccurrenceIdentityV2(db).applied, true);
    assert.ok(db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(OCCURRENCE_IDENTITY_MIGRATION));
    assert.equal(getTodoHighWater(db, 'owner'), 6626);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('server high-water rejects stale new ids, preserves known historical re-add, restart, and workspace isolation', () => {
  const { db, file, dir } = makeDb();
  try {
    writeTodoHighWater(db, 'workspace-a', 9000);
    writeTodoHighWater(db, 'workspace-b', 12);
    const staleNew = { id: 6626, done: false, status: 'pending' };
    assert.deepEqual(findTodoIdCollisions(db, 'workspace-a', [], [staleNew]), ['6626']);
    assert.deepEqual(findTodoIdCollisions(db, 'workspace-b', [], [staleNew]), []);
    assert.equal(documentTodoHighWater({ todos: [{ id: 100 }], _nextId: { todos: 9001 } }), 9000);
    assert.deepEqual(findTodoIdCollisions(
      db, 'workspace-a',
      [{ id: 7000, created_at: '2026-01-01T00:00:00Z' }],
      [{ id: 7000, created_at: '2026-08-18T00:00:00Z' }]
    ), ['7000']);

    const historical = snapshot(6626, 9, '1405/04/25');
    enqueueTodoAuditEvents(db, 'workspace-a', {}, diffTodos([], [historical]));
    assert.deepEqual(findTodoIdCollisions(db, 'workspace-a', [], [historical]), []);
    assert.deepEqual(
      findTodoIdCollisions(db, 'workspace-a', [historical], [snapshot(6626, 9, '1405/05/27')]),
      ['6626']
    );
    db.close();

    const reopened = new Database(file);
    initTodoAuditStore(reopened);
    assert.equal(getTodoHighWater(reopened, 'workspace-a'), 9000);
    assert.equal(getTodoHighWater(reopened, 'workspace-b'), 12);
    writeTodoHighWater(reopened, 'workspace-a', 100);
    assert.equal(getTodoHighWater(reopened, 'workspace-a'), 9000);
    reopened.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
