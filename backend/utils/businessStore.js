const { createHash } = require('crypto');

const BUSINESS_COLLECTIONS = Object.freeze(['students', 'sessions', 'payments']);
const BUSINESS_MIGRATION = 'phase5_business_rows_v1';

function hashText(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function assertCollection(collection) {
  if (!BUSINESS_COLLECTIONS.includes(collection)) throw new Error('invalid_business_collection');
  return collection;
}

function rowId(row) {
  const value = row?.id;
  return value == null ? '' : String(value);
}

function dateKey(row) {
  const value = String(row?.date_jalali || row?.date || row?.created_at || '').replace(/\D/g, '').slice(0, 8);
  return Number(value) || 0;
}

function searchableText(row) {
  return [row?.name, row?.lname, row?.phone, row?.organization_name, row?.title, row?.note]
    .filter(Boolean).join(' ').toLocaleLowerCase('fa').slice(0, 1200);
}

function ensureBusinessStoreSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workspace_business_rows (
      storage_key TEXT NOT NULL,
      collection_key TEXT NOT NULL,
      row_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      date_key INTEGER NOT NULL DEFAULT 0,
      search_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT,
      PRIMARY KEY(storage_key,collection_key,row_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_business_page
      ON workspace_business_rows(storage_key,collection_key,archived,date_key,row_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_business_date
      ON workspace_business_rows(storage_key,collection_key,date_key,row_id);
    CREATE TABLE IF NOT EXISTS workspace_business_state (
      storage_key TEXT NOT NULL,
      collection_key TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      archived_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(storage_key,collection_key)
    );
    CREATE TABLE IF NOT EXISTS workspace_business_migrations (
      storage_key TEXT NOT NULL,
      collection_key TEXT NOT NULL,
      migrated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(storage_key,collection_key)
    );
  `);
}

function refreshState(db, storageKey, collection) {
  assertCollection(collection);
  const rows = db.prepare(`
    SELECT row_id,payload_hash,archived FROM workspace_business_rows
    WHERE storage_key=? AND collection_key=? ORDER BY row_id
  `).all(storageKey, collection);
  const dataHash = hashText(rows.map(row => `${row.row_id}:${row.payload_hash}`).join('|'));
  const archivedCount = rows.reduce((n, row) => n + (row.archived ? 1 : 0), 0);
  db.prepare(`
    INSERT INTO workspace_business_state(storage_key,collection_key,data_hash,row_count,archived_count,updated_at)
    VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(storage_key,collection_key) DO UPDATE SET
      data_hash=excluded.data_hash,row_count=excluded.row_count,
      archived_count=excluded.archived_count,updated_at=datetime('now')
  `).run(storageKey, collection, dataHash, rows.length, archivedCount);
  return dataHash;
}

function collectionState(db, storageKey, collection) {
  ensureBusinessStoreSchema(db);
  assertCollection(collection);
  return db.prepare(`
    SELECT data_hash,row_count,archived_count,updated_at FROM workspace_business_state
    WHERE storage_key=? AND collection_key=?
  `).get(storageKey, collection) || null;
}

function hasMigratedCollection(db, storageKey, collection) {
  ensureBusinessStoreSchema(db);
  assertCollection(collection);
  return !!db.prepare(`
    SELECT 1 FROM workspace_business_migrations WHERE storage_key=? AND collection_key=?
  `).get(storageKey, collection);
}

function upsertRows(db, storageKey, collection, rows, { refresh = true } = {}) {
  ensureBusinessStoreSchema(db);
  assertCollection(collection);
  const find = db.prepare(`
    SELECT payload_hash FROM workspace_business_rows
    WHERE storage_key=? AND collection_key=? AND row_id=?
  `);
  const put = db.prepare(`
    INSERT INTO workspace_business_rows(
      storage_key,collection_key,row_id,payload,payload_hash,archived,date_key,search_text,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(storage_key,collection_key,row_id) DO UPDATE SET
      payload=excluded.payload,payload_hash=excluded.payload_hash,archived=excluded.archived,
      date_key=excluded.date_key,search_text=excluded.search_text,updated_at=excluded.updated_at
  `);
  let changed = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = rowId(row);
    if (!id) continue;
    const payload = JSON.stringify(row);
    const payloadHash = hashText(payload);
    if (find.get(storageKey, collection, id)?.payload_hash === payloadHash) continue;
    put.run(storageKey, collection, id, payload, payloadHash, row?.archived ? 1 : 0,
      dateKey(row), searchableText(row), row?.updated_at || row?.created_at || null);
    changed++;
  }
  if (refresh && changed) refreshState(db, storageKey, collection);
  return changed;
}

function deleteRows(db, storageKey, collection, ids, { refresh = true } = {}) {
  ensureBusinessStoreSchema(db);
  assertCollection(collection);
  const remove = db.prepare(`
    DELETE FROM workspace_business_rows WHERE storage_key=? AND collection_key=? AND row_id=?
  `);
  let changed = 0;
  for (const id of new Set((ids || []).map(String).filter(Boolean))) {
    changed += remove.run(storageKey, collection, id).changes || 0;
  }
  if (refresh && changed) refreshState(db, storageKey, collection);
  return changed;
}

function replaceRows(db, storageKey, collection, rows) {
  ensureBusinessStoreSchema(db);
  assertCollection(collection);
  return db.transaction(() => {
    db.prepare('DELETE FROM workspace_business_rows WHERE storage_key=? AND collection_key=?')
      .run(storageKey, collection);
    upsertRows(db, storageKey, collection, rows, { refresh: false });
    db.prepare(`
      INSERT OR IGNORE INTO workspace_business_migrations(storage_key,collection_key) VALUES (?,?)
    `).run(storageKey, collection);
    return refreshState(db, storageKey, collection);
  })();
}

function loadAllRows(db, storageKey, collection) {
  ensureBusinessStoreSchema(db);
  assertCollection(collection);
  return db.prepare(`
    SELECT payload FROM workspace_business_rows
    WHERE storage_key=? AND collection_key=? ORDER BY date_key,row_id
  `).all(storageKey, collection).map(row => {
    try { return JSON.parse(row.payload); } catch (_) { return null; }
  }).filter(Boolean);
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.date_key, row.row_id]), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    return Array.isArray(value) && value.length === 2 ? value : null;
  } catch (_) { return null; }
}

function loadRowsPage(db, storageKey, collection, options = {}) {
  ensureBusinessStoreSchema(db);
  assertCollection(collection);
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 200));
  const cursor = decodeCursor(options.cursor);
  const params = [storageKey, collection];
  const where = [];
  if (options.archived != null) {
    where.push('archived=?');
    params.push(options.archived ? 1 : 0);
  }
  if (options.dateFrom) { where.push('date_key>=?'); params.push(Number(String(options.dateFrom).replace(/\D/g, '').slice(0, 8)) || 0); }
  if (options.dateTo) { where.push('date_key<=?'); params.push(Number(String(options.dateTo).replace(/\D/g, '').slice(0, 8)) || 99999999); }
  if (options.search) { where.push('search_text LIKE ?'); params.push(`%${String(options.search).toLocaleLowerCase('fa').slice(0, 100)}%`); }
  if (cursor) {
    where.push('(date_key>? OR (date_key=? AND row_id>?))');
    params.push(Number(cursor[0]) || 0, Number(cursor[0]) || 0, String(cursor[1]));
  }
  const rows = db.prepare(`
    SELECT row_id,payload,date_key FROM workspace_business_rows
    WHERE storage_key=? AND collection_key=?${where.length ? ` AND ${where.join(' AND ')}` : ''}
    ORDER BY date_key,row_id LIMIT ?
  `).all(...params, limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map(row => { try { return JSON.parse(row.payload); } catch (_) { return null; } }).filter(Boolean),
    next_cursor: rows.length > limit && page.length ? encodeCursor(page[page.length - 1]) : null,
  };
}

function migrateBusinessParts(db) {
  ensureBusinessStoreSchema(db);
  if (db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(BUSINESS_MIGRATION)) {
    return { applied: false, collections: 0, rows: 0 };
  }
  const placeholders = BUSINESS_COLLECTIONS.map(() => '?').join(',');
  const parts = db.prepare(`
    SELECT account_id,part_key,data FROM user_data_parts WHERE part_key IN (${placeholders})
  `).all(...BUSINESS_COLLECTIONS);
  let migratedRows = 0;
  const affected = new Set(parts.map(part => part.account_id));
  db.transaction(() => {
    for (const part of parts) {
      let rows = [];
      try { rows = JSON.parse(part.data || '[]'); } catch (_) { rows = []; }
      if (!Array.isArray(rows)) rows = [];
      replaceRows(db, part.account_id, part.part_key, rows);
      migratedRows += rows.length;
      db.prepare('DELETE FROM user_data_parts WHERE account_id=? AND part_key=?')
        .run(part.account_id, part.part_key);
    }
    for (const storageKey of affected) {
      const hashes = db.prepare(
        'SELECT part_key,data_hash FROM user_data_parts WHERE account_id=?'
      ).all(storageKey);
      const hasTodoState = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_todo_state'"
      ).get();
      const todo = hasTodoState ? db.prepare(
        'SELECT data_hash FROM workspace_todo_state WHERE storage_key=?'
      ).get(storageKey) : null;
      if (todo) hashes.push({ part_key: 'todos', data_hash: todo.data_hash });
      db.prepare(`
        SELECT collection_key AS part_key,data_hash FROM workspace_business_state WHERE storage_key=?
      `).all(storageKey).forEach(row => hashes.push(row));
      const etag = hashText(hashes.sort((a, b) => a.part_key.localeCompare(b.part_key))
        .map(part => `${part.part_key}:${part.data_hash}`).join('|'));
      db.prepare('UPDATE user_data SET data_etag=? WHERE account_id=?').run(etag, storageKey);
    }
    db.prepare('INSERT INTO app_migrations(name) VALUES (?)').run(BUSINESS_MIGRATION);
  })();
  return { applied: true, collections: parts.length, rows: migratedRows };
}

function deleteBusinessWorkspace(db, storageKey) {
  ensureBusinessStoreSchema(db);
  db.prepare('DELETE FROM workspace_business_rows WHERE storage_key=?').run(storageKey);
  db.prepare('DELETE FROM workspace_business_state WHERE storage_key=?').run(storageKey);
  db.prepare('DELETE FROM workspace_business_migrations WHERE storage_key=?').run(storageKey);
}

module.exports = {
  BUSINESS_COLLECTIONS,
  BUSINESS_MIGRATION,
  ensureBusinessStoreSchema,
  migrateBusinessParts,
  hasMigratedCollection,
  collectionState,
  loadAllRows,
  loadRowsPage,
  upsertRows,
  deleteRows,
  replaceRows,
  deleteBusinessWorkspace,
};
