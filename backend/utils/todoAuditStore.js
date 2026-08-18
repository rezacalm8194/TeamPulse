const { randomUUID } = require('crypto');
const { recurringSnapshotIdentity } = require('./todoAudit');

const HISTORICAL_SEED_MIGRATION = 'todo_audit_historical_seed_v1';

function recurringEventKey(storageKey, snapshotId) {
  return `${String(storageKey)}:todo_completed:snapshot:${String(snapshotId)}`;
}

function safeParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function initTodoAuditStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS todo_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL UNIQUE,
      event TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      root_todo_id TEXT,
      occurrence TEXT,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','written','seeded')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      written_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_todo_audit_events_status_id
      ON todo_audit_events(status, id);
  `);
}

function seedIdentity(db, storageKey, identity) {
  db.prepare(`
    INSERT OR IGNORE INTO todo_audit_events
      (event_key,event,entity_id,root_todo_id,occurrence,payload_json,status)
    VALUES (?,?,?,?,?,NULL,'seeded')
  `).run(
    recurringEventKey(storageKey, identity.snapshotId),
    'todo_completed', identity.snapshotId, identity.rootTodoId, identity.occurrence
  );
}

function seedDocument(db, storageKey, document) {
  const todos = Array.isArray(document?.todos) ? document.todos : [];
  for (const todo of todos) {
    const identity = recurringSnapshotIdentity(todo);
    if (identity) seedIdentity(db, storageKey, identity);
  }
}

function seedHistoricalRecurringSnapshots(db) {
  const run = db.transaction(() => {
    const applied = db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(HISTORICAL_SEED_MIGRATION);
    if (applied) return { applied: false, historicalScanCount: 0 };

    let historicalScanCount = 0;
    historicalScanCount += 1;
    const currentRows = db.prepare("SELECT account_id,data FROM user_data WHERE account_id!='__admin_settings__'").all();
    for (const row of currentRows) seedDocument(db, row.account_id, safeParse(row.data, {}));

    const hasVersions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_data_versions'").get();
    if (hasVersions) {
      historicalScanCount += 1;
      for (const row of db.prepare('SELECT account_id,data FROM user_data_versions').all()) {
        seedDocument(db, row.account_id, safeParse(row.data, {}));
      }
    }

    // Tombstones are the only durable trace for an item absent from both the
    // current document and retained versions. Conservatively reserve their
    // recurring event keys; this stores identities only and emits no audit.
    for (const row of currentRows) {
      const document = safeParse(row.data, {});
      const tombstones = Array.isArray(document?._todoTombstones) ? document._todoTombstones : [];
      for (const id of tombstones) {
        if (id == null || id === '') continue;
        seedIdentity(db, row.account_id, { snapshotId: String(id), rootTodoId: null, occurrence: null });
      }
    }
    db.prepare('INSERT INTO app_migrations(name) VALUES (?)').run(HISTORICAL_SEED_MIGRATION);
    return { applied: true, historicalScanCount };
  });
  return run();
}

function enqueueTodoAuditEvents(db, storageKey, requestContext, changes) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO todo_audit_events
      (event_key,event,entity_id,root_todo_id,occurrence,payload_json,status)
    VALUES (?,?,?,?,?,?,'pending')
  `);
  const insertedIds = [];
  for (const change of Array.isArray(changes) ? changes : []) {
    const eventKey = change.recurringSnapshot
      ? recurringEventKey(storageKey, change.entityId)
      : `${String(storageKey)}:${change.event}:${randomUUID()}`;
    const payload = {
      requestId: requestContext?.requestId || null,
      actorUserId: requestContext?.actorUserId || null,
      targetUserId: change.targetUserId || null,
      entityType: 'todo',
      entityId: String(change.entityId),
      metadata: change.metadata || {},
    };
    const result = insert.run(
      eventKey, change.event, String(change.entityId),
      change.metadata?.rootTodoId || null, change.metadata?.occurrence || null,
      JSON.stringify(payload)
    );
    if (result.changes) insertedIds.push(Number(result.lastInsertRowid));
  }
  return insertedIds;
}

let flushPromise = null;
function flushPendingTodoAudits(db, logger) {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    for (;;) {
      const row = db.prepare("SELECT id,event,payload_json FROM todo_audit_events WHERE status='pending' ORDER BY id LIMIT 1").get();
      if (!row) break;
      const payload = safeParse(row.payload_json, {});
      await logger.auditAsync(row.event, { auditEventId: `todo-audit-${row.id}`, ...payload });
      db.prepare("UPDATE todo_audit_events SET status='written',written_at=datetime('now') WHERE id=? AND status='pending'").run(row.id);
    }
  })().catch(error => {
    try { logger.error('todo_audit_flush_failed', { errorCode: error?.code || error?.name || 'AUDIT_WRITE_FAILED' }); } catch {}
  }).finally(() => { flushPromise = null; });
  return flushPromise;
}

module.exports = {
  HISTORICAL_SEED_MIGRATION,
  recurringEventKey,
  initTodoAuditStore,
  seedHistoricalRecurringSnapshots,
  enqueueTodoAuditEvents,
  flushPendingTodoAudits,
};
