const { createHash } = require('crypto');

const TODO_MIGRATION = 'phase4_workspace_todos_v1';

function hashText(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function todoId(todo) {
  const value = todo && todo.id;
  return value == null ? '' : String(value);
}

function todoDateKey(todo) {
  const raw = String(
    todo?.scheduled_date || todo?.scheduledDate || todo?.date_jalali || todo?.date || ''
  )
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\D/g, '');
  const value = Number(raw.slice(0, 8));
  return Number.isFinite(value) ? value : 0;
}

function ensureTodoStoreSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workspace_todos (
      storage_key TEXT NOT NULL,
      todo_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      date_key INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      PRIMARY KEY (storage_key, todo_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_todos_archived
      ON workspace_todos(storage_key, archived, date_key, todo_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_todos_date
      ON workspace_todos(storage_key, date_key, todo_id);
    CREATE TABLE IF NOT EXISTS workspace_todo_state (
      storage_key TEXT PRIMARY KEY,
      data_hash TEXT NOT NULL,
      todo_count INTEGER NOT NULL DEFAULT 0,
      active_count INTEGER NOT NULL DEFAULT 0,
      archived_count INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workspace_todo_migrations (
      storage_key TEXT PRIMARY KEY,
      migrated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const todoCols = db.prepare('PRAGMA table_info(workspace_todos)').all();
  if (todoCols.length && !todoCols.some(col => col.name === 'done')) {
    db.exec('ALTER TABLE workspace_todos ADD COLUMN done INTEGER NOT NULL DEFAULT 0');
  }
  const stateCols = db.prepare('PRAGMA table_info(workspace_todo_state)').all();
  if (stateCols.length && !stateCols.some(col => col.name === 'pending_count')) {
    db.exec('ALTER TABLE workspace_todo_state ADD COLUMN pending_count INTEGER NOT NULL DEFAULT 0');
  }
}

function refreshTodoState(db, storageKey) {
  const rows = db.prepare(
    'SELECT todo_id,payload_hash,archived,done FROM workspace_todos WHERE storage_key=? ORDER BY todo_id'
  ).all(storageKey);
  const dataHash = hashText(rows.map(row => `${row.todo_id}:${row.payload_hash}`).join('|'));
  const archivedCount = rows.reduce((n, row) => n + (row.archived ? 1 : 0), 0);
  const pendingCount = rows.reduce((n, row) => n + (!row.archived && !row.done ? 1 : 0), 0);
  db.prepare(`
    INSERT INTO workspace_todo_state(storage_key,data_hash,todo_count,active_count,archived_count,pending_count,updated_at)
    VALUES (?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(storage_key) DO UPDATE SET
      data_hash=excluded.data_hash,
      todo_count=excluded.todo_count,
      active_count=excluded.active_count,
      archived_count=excluded.archived_count,
      pending_count=excluded.pending_count,
      updated_at=datetime('now')
  `).run(storageKey, dataHash, rows.length, rows.length - archivedCount, archivedCount, pendingCount);
  return dataHash;
}

function todoState(db, storageKey) {
  ensureTodoStoreSchema(db);
  return db.prepare(
    'SELECT data_hash,todo_count,active_count,archived_count,pending_count,updated_at FROM workspace_todo_state WHERE storage_key=?'
  ).get(storageKey) || null;
}

function hasMigratedTodos(db, storageKey) {
  ensureTodoStoreSchema(db);
  return !!db.prepare('SELECT 1 FROM workspace_todo_migrations WHERE storage_key=?').get(storageKey);
}

function upsertTodos(db, storageKey, todos, { refresh = true } = {}) {
  ensureTodoStoreSchema(db);
  const upsert = db.prepare(`
    INSERT INTO workspace_todos(storage_key,todo_id,payload,payload_hash,archived,done,date_key,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(storage_key,todo_id) DO UPDATE SET
      payload=excluded.payload,
      payload_hash=excluded.payload_hash,
      archived=excluded.archived,
      done=excluded.done,
      date_key=excluded.date_key,
      updated_at=excluded.updated_at
  `);
  let changed = 0;
  for (const todo of Array.isArray(todos) ? todos : []) {
    const id = todoId(todo);
    if (!id) continue;
    const payload = JSON.stringify(todo);
    const payloadHash = hashText(payload);
    const previous = db.prepare(
      'SELECT payload_hash FROM workspace_todos WHERE storage_key=? AND todo_id=?'
    ).get(storageKey, id);
    if (previous?.payload_hash === payloadHash) continue;
    upsert.run(storageKey, id, payload, payloadHash, todo?.archived ? 1 : 0, todo?.done ? 1 : 0,
      todoDateKey(todo), todo?.updated_at || null);
    changed++;
  }
  if (refresh && changed) refreshTodoState(db, storageKey);
  return changed;
}

function deleteTodos(db, storageKey, ids, { refresh = true } = {}) {
  ensureTodoStoreSchema(db);
  const remove = db.prepare('DELETE FROM workspace_todos WHERE storage_key=? AND todo_id=?');
  let changed = 0;
  for (const id of new Set((ids || []).map(String).filter(Boolean))) {
    changed += remove.run(storageKey, id).changes || 0;
  }
  if (refresh && changed) refreshTodoState(db, storageKey);
  return changed;
}

function replaceTodos(db, storageKey, todos) {
  ensureTodoStoreSchema(db);
  const run = db.transaction(() => {
    db.prepare('DELETE FROM workspace_todos WHERE storage_key=?').run(storageKey);
    upsertTodos(db, storageKey, todos, { refresh: false });
    db.prepare('INSERT OR IGNORE INTO workspace_todo_migrations(storage_key) VALUES (?)').run(storageKey);
    return refreshTodoState(db, storageKey);
  });
  return run();
}

function loadAllTodos(db, storageKey) {
  ensureTodoStoreSchema(db);
  return db.prepare(
    'SELECT payload FROM workspace_todos WHERE storage_key=? ORDER BY date_key,todo_id'
  ).all(storageKey).map(row => {
    try { return JSON.parse(row.payload); } catch (_) { return null; }
  }).filter(Boolean);
}

function loadTodosByIds(db, storageKey, ids) {
  ensureTodoStoreSchema(db);
  const values = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!values.length) return [];
  const placeholders = values.map(() => '?').join(',');
  return db.prepare(`
    SELECT payload FROM workspace_todos
    WHERE storage_key=? AND todo_id IN (${placeholders})
  `).all(storageKey, ...values).map(row => {
    try { return JSON.parse(row.payload); } catch (_) { return null; }
  }).filter(Boolean);
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.date_key, row.todo_id]), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    return Array.isArray(value) && value.length === 2 ? value : null;
  } catch (_) { return null; }
}

function loadTodosPage(db, storageKey, { limit = 200, cursor = null, archived = 0, filter = null } = {}) {
  ensureTodoStoreSchema(db);
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  const visible = [];
  let decoded = decodeCursor(cursor);
  let exhausted = false;
  while (visible.length <= safeLimit && !exhausted) {
    const params = [storageKey, archived ? 1 : 0];
    let after = '';
    if (decoded) {
      after = ' AND (date_key > ? OR (date_key = ? AND todo_id > ?))';
      params.push(Number(decoded[0]) || 0, Number(decoded[0]) || 0, String(decoded[1]));
    }
    const rows = db.prepare(`
      SELECT todo_id,payload,date_key
      FROM workspace_todos
      WHERE storage_key=? AND archived=?${after}
      ORDER BY date_key,todo_id
      LIMIT ?
    `).all(...params, safeLimit + 1);
    exhausted = rows.length < safeLimit + 1;
    for (const row of rows) {
      let todo;
      try { todo = JSON.parse(row.payload); } catch (_) { continue; }
      if (!filter || filter(todo)) visible.push({ ...row, todo });
      if (visible.length > safeLimit) break;
    }
    const lastScanned = rows[rows.length - 1];
    if (!lastScanned || visible.length > safeLimit) break;
    decoded = [lastScanned.date_key, lastScanned.todo_id];
  }
  const pageRows = visible.slice(0, safeLimit);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map(row => row.todo),
    next_cursor: visible.length > safeLimit && last ? encodeCursor(last) : null,
  };
}

function countTodos(db, storageKey, archived = null) {
  ensureTodoStoreSchema(db);
  if (archived == null) return Number(todoState(db, storageKey)?.todo_count || 0);
  const state = todoState(db, storageKey);
  return Number(archived ? state?.archived_count : state?.active_count) || 0;
}

function migrateTodosFromDocumentPart(db) {
  ensureTodoStoreSchema(db);
  const applied = db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(TODO_MIGRATION);
  if (applied) return { applied: false, workspaces: 0, todos: 0 };
  const rows = db.prepare("SELECT account_id,data FROM user_data_parts WHERE part_key='todos'").all();
  let todos = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      let value = [];
      try { value = JSON.parse(row.data || '[]'); } catch (_) { value = []; }
      if (!Array.isArray(value)) value = [];
      replaceTodos(db, row.account_id, value);
      todos += value.length;
      db.prepare("DELETE FROM user_data_parts WHERE account_id=? AND part_key='todos'").run(row.account_id);
      const hashes = db.prepare(
        'SELECT part_key,data_hash FROM user_data_parts WHERE account_id=? ORDER BY part_key'
      ).all(row.account_id);
      const state = todoState(db, row.account_id);
      if (state) hashes.push({ part_key: 'todos', data_hash: state.data_hash });
      const etag = hashText(hashes.sort((a, b) => a.part_key.localeCompare(b.part_key))
        .map(part => `${part.part_key}:${part.data_hash}`).join('|'));
      db.prepare('UPDATE user_data SET data_etag=? WHERE account_id=?').run(etag, row.account_id);
    }
    db.prepare('INSERT INTO app_migrations(name) VALUES (?)').run(TODO_MIGRATION);
  });
  run();
  return { applied: true, workspaces: rows.length, todos };
}

function deleteTodoWorkspace(db, storageKey) {
  ensureTodoStoreSchema(db);
  db.prepare('DELETE FROM workspace_todos WHERE storage_key=?').run(storageKey);
  db.prepare('DELETE FROM workspace_todo_state WHERE storage_key=?').run(storageKey);
  db.prepare('DELETE FROM workspace_todo_migrations WHERE storage_key=?').run(storageKey);
}

module.exports = {
  TODO_MIGRATION,
  ensureTodoStoreSchema,
  migrateTodosFromDocumentPart,
  hasMigratedTodos,
  todoState,
  refreshTodoState,
  loadAllTodos,
  loadTodosByIds,
  loadTodosPage,
  countTodos,
  upsertTodos,
  deleteTodos,
  replaceTodos,
  deleteTodoWorkspace,
};
