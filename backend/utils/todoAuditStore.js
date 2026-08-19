const { randomUUID } = require('crypto');
const { recurringSnapshotIdentity } = require('./todoAudit');

const HISTORICAL_SEED_MIGRATION = 'todo_audit_historical_seed_v1';
const OCCURRENCE_IDENTITY_MIGRATION = 'todo_audit_occurrence_identity_v2';

function normalizeOccurrence(value) {
  if (value == null || value === '') return '';
  return String(value).trim()
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[-.]/g, '/').replace(/\/+/g, '/');
}

function legacyRecurringEventKey(storageKey, snapshotId) {
  return `${String(storageKey)}:todo_completed:snapshot:${String(snapshotId)}`;
}

function recurringEventKey(storageKey, snapshotId, rootTodoId, occurrence) {
  return `${legacyRecurringEventKey(storageKey, snapshotId)}:root:${encodeURIComponent(String(rootTodoId ?? ''))}:occurrence:${encodeURIComponent(normalizeOccurrence(occurrence))}`;
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
    CREATE TABLE IF NOT EXISTS todo_id_high_water (
      storage_key TEXT PRIMARY KEY,
      high_water INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_todo_audit_events_status_id
      ON todo_audit_events(status, id);
  `);
  const columns = db.prepare('PRAGMA table_info(todo_audit_events)').all();
  if (!columns.some(column => column.name === 'storage_key')) {
    db.exec('ALTER TABLE todo_audit_events ADD COLUMN storage_key TEXT');
  }
}

function seedIdentity(db, storageKey, identity) {
  db.prepare(`
    INSERT OR IGNORE INTO todo_audit_events
      (event_key,event,entity_id,root_todo_id,occurrence,payload_json,status)
    VALUES (?,?,?,?,?,NULL,'seeded')
  `).run(
    legacyRecurringEventKey(storageKey, identity.snapshotId),
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

function numericTodoId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function documentTodoHighWater(document) {
  let highWater = numericTodoId(document?._todoIdHighWater);
  highWater = Math.max(highWater, Math.max(0, numericTodoId(document?._nextId?.todos) - 1));
  for (const todo of Array.isArray(document?.todos) ? document.todos : []) {
    highWater = Math.max(highWater, numericTodoId(todo?.id));
  }
  for (const id of Array.isArray(document?._todoTombstones) ? document._todoTombstones : []) {
    highWater = Math.max(highWater, numericTodoId(id));
  }
  return highWater;
}

function writeTodoHighWater(db, storageKey, highWater) {
  const value = numericTodoId(highWater);
  if (!value) return;
  db.prepare(`
    INSERT INTO todo_id_high_water(storage_key,high_water) VALUES (?,?)
    ON CONFLICT(storage_key) DO UPDATE SET
      high_water=MAX(todo_id_high_water.high_water,excluded.high_water),
      updated_at=datetime('now')
  `).run(String(storageKey), value);
}

function getTodoHighWater(db, storageKey) {
  return Number(db.prepare('SELECT high_water FROM todo_id_high_water WHERE storage_key=?').get(String(storageKey))?.high_water || 0);
}

function seedOccurrenceIdentity(db, storageKey, identity) {
  db.prepare(`
    INSERT OR IGNORE INTO todo_audit_events
      (event_key,event,entity_id,root_todo_id,occurrence,payload_json,status,storage_key)
    VALUES (?,?,?,?,?,NULL,'seeded',?)
  `).run(
    recurringEventKey(storageKey, identity.snapshotId, identity.rootTodoId, identity.occurrence),
    'todo_completed', identity.snapshotId, identity.rootTodoId,
    normalizeOccurrence(identity.occurrence) || null, String(storageKey)
  );
}

function seedOccurrenceDocument(db, storageKey, document, highWaterByStorage) {
  highWaterByStorage.set(storageKey, Math.max(
    highWaterByStorage.get(storageKey) || 0,
    documentTodoHighWater(document)
  ));
  for (const todo of Array.isArray(document?.todos) ? document.todos : []) {
    const identity = recurringSnapshotIdentity(todo);
    if (identity) seedOccurrenceIdentity(db, storageKey, identity);
  }
}

function storageKeyFromAuditRow(row) {
  if (row.storage_key) return String(row.storage_key);
  const marker = ':todo_completed:snapshot:';
  const index = String(row.event_key || '').lastIndexOf(marker);
  return index > 0 ? String(row.event_key).slice(0, index) : '';
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

function migrateTodoAuditOccurrenceIdentityV2(db) {
  const run = db.transaction(() => {
    const applied = db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(OCCURRENCE_IDENTITY_MIGRATION);
    if (applied) return { applied: false, historicalScanCount: 0 };

    let historicalScanCount = 1;
    const highWaterByStorage = new Map();
    const currentRows = db.prepare("SELECT account_id,data FROM user_data WHERE account_id!='__admin_settings__'").all();
    for (const row of currentRows) seedOccurrenceDocument(db, row.account_id, safeParse(row.data, {}), highWaterByStorage);

    const hasVersions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_data_versions'").get();
    if (hasVersions) {
      historicalScanCount += 1;
      for (const row of db.prepare('SELECT account_id,data FROM user_data_versions').all()) {
        seedOccurrenceDocument(db, row.account_id, safeParse(row.data, {}), highWaterByStorage);
      }
    }

    for (const row of db.prepare('SELECT event_key,entity_id,storage_key FROM todo_audit_events').all()) {
      const storageKey = storageKeyFromAuditRow(row);
      if (!storageKey) continue;
      highWaterByStorage.set(storageKey, Math.max(highWaterByStorage.get(storageKey) || 0, numericTodoId(row.entity_id)));
    }
    for (const [storageKey, highWater] of highWaterByStorage) writeTodoHighWater(db, storageKey, highWater);
    db.prepare('INSERT INTO app_migrations(name) VALUES (?)').run(OCCURRENCE_IDENTITY_MIGRATION);
    return { applied: true, historicalScanCount };
  });
  return run();
}

function recurringOccurrenceKnown(db, storageKey, todo) {
  const identity = recurringSnapshotIdentity(todo);
  if (!identity) return false;
  return !!db.prepare('SELECT 1 FROM todo_audit_events WHERE event_key=?').get(
    recurringEventKey(storageKey, identity.snapshotId, identity.rootTodoId, identity.occurrence)
  );
}

function findTodoIdCollisions(db, storageKey, previousTodos, nextTodos) {
  const highWater = getTodoHighWater(db, storageKey);
  const previousById = new Map((Array.isArray(previousTodos) ? previousTodos : []).map(todo => [String(todo?.id), todo]));
  return (Array.isArray(nextTodos) ? nextTodos : []).filter(todo => {
    const id = numericTodoId(todo?.id);
    if (!id) return false;
    const previous = previousById.get(String(todo.id));
    if (previous) {
      const beforeIdentity = recurringSnapshotIdentity(previous);
      const nextIdentity = recurringSnapshotIdentity(todo);
      if (!beforeIdentity && !nextIdentity) {
        const previousCreatedAt = String(previous?.created_at || '').trim();
        const nextCreatedAt = String(todo?.created_at || '').trim();
        return !!(previousCreatedAt && nextCreatedAt && previousCreatedAt !== nextCreatedAt);
      }
      if (!beforeIdentity || !nextIdentity) return true;
      return beforeIdentity.rootTodoId !== nextIdentity.rootTodoId ||
        normalizeOccurrence(beforeIdentity.occurrence) !== normalizeOccurrence(nextIdentity.occurrence);
    }
    if (id > highWater) return false;
    return !recurringOccurrenceKnown(db, storageKey, todo);
  }).map(todo => String(todo.id));
}

function enqueueTodoAuditEvents(db, storageKey, requestContext, changes) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO todo_audit_events
      (event_key,event,entity_id,root_todo_id,occurrence,payload_json,status,storage_key)
    VALUES (?,?,?,?,?,?,'pending',?)
  `);
  const insertedIds = [];
  for (const change of Array.isArray(changes) ? changes : []) {
    const eventKey = change.recurringSnapshot
      ? recurringEventKey(storageKey, change.entityId, change.metadata?.rootTodoId, change.metadata?.occurrence)
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
      JSON.stringify(payload), String(storageKey)
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
  OCCURRENCE_IDENTITY_MIGRATION,
  normalizeOccurrence,
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
};
