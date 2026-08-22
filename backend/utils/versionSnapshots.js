const { createHash } = require('crypto');

// Version blobs stay in user_data_versions. Listing must never SELECT that
// table: SQLite stores the whole row together, so reading metadata from the
// same row would pull up to 72 full snapshots from disk. Counts/size/hash live
// in user_data_version_summaries and are written once when a snapshot is saved.

const VERSION_MIN_INTERVAL_MS = 60 * 60 * 1000;
const MAX_VERSIONS_PER_WORKSPACE = 72;

function hashSerialized(serializedData) {
  return createHash('sha256').update(String(serializedData || '')).digest('hex');
}

function arrayLen(data, key) {
  return Array.isArray(data?.[key]) ? data[key].length : 0;
}

function versionSummaryFromSerialized(serializedData) {
  const raw = String(serializedData || '');
  let data = {};
  try { data = JSON.parse(raw || '{}'); } catch { data = {}; }
  return {
    data_size: Buffer.byteLength(raw, 'utf8'),
    data_hash: hashSerialized(raw),
    todos: arrayLen(data, 'todos'),
    students: arrayLen(data, 'students'),
    staff: arrayLen(data, 'staff'),
    instructions: arrayLen(data, 'instructions'),
  };
}

function formatVersionCreatedAt(createdAt) {
  return createdAt ? String(createdAt).replace(' ', 'T') + 'Z' : null;
}

function ensureVersionSnapshotSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_data_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_data_versions_account
      ON user_data_versions(account_id, created_at);
    CREATE TABLE IF NOT EXISTS user_data_version_summaries (
      version_id INTEGER PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at TEXT,
      data_size INTEGER NOT NULL DEFAULT 0,
      data_hash TEXT,
      todos INTEGER NOT NULL DEFAULT 0,
      students INTEGER NOT NULL DEFAULT 0,
      staff INTEGER NOT NULL DEFAULT 0,
      instructions INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (version_id) REFERENCES user_data_versions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_data_version_summaries_account
      ON user_data_version_summaries(account_id, version_id DESC);
  `);
}

function insertVersionSummary(db, versionId, accountId, createdAt, serializedData) {
  const summary = versionSummaryFromSerialized(serializedData);
  db.prepare(`
    INSERT INTO user_data_version_summaries (
      version_id, account_id, created_at, data_size, data_hash,
      todos, students, staff, instructions
    ) VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    versionId,
    accountId,
    createdAt,
    summary.data_size,
    summary.data_hash,
    summary.todos,
    summary.students,
    summary.staff,
    summary.instructions
  );
  return summary;
}

function backfillVersionSummaries(db) {
  const selectMissing = db.prepare(`
    SELECT v.id, v.account_id, v.created_at, v.data
    FROM user_data_versions v
    LEFT JOIN user_data_version_summaries s ON s.version_id = v.id
    WHERE s.version_id IS NULL AND v.id > ?
    ORDER BY v.id
    LIMIT 8
  `);
  const fill = db.transaction(rows => {
    for (const row of rows) {
      insertVersionSummary(db, row.id, row.account_id, row.created_at, row.data);
    }
  });
  let lastId = 0;
  for (;;) {
    const missing = selectMissing.all(lastId);
    if (!missing.length) return;
    fill(missing);
    lastId = missing[missing.length - 1].id;
  }
}

function saveVersionSnapshot(db, accountId, serializedData, { force = false } = {}) {
  const latestMeta = db.prepare(`
    SELECT version_id, created_at, data_hash
    FROM user_data_version_summaries
    WHERE account_id=?
    ORDER BY version_id DESC
    LIMIT 1
  `).get(accountId);
  const incomingHash = hashSerialized(serializedData);
  if (latestMeta?.data_hash && latestMeta.data_hash === incomingHash) return false;
  if (!latestMeta) {
    const latest = db.prepare(`
      SELECT id,data,created_at FROM user_data_versions
      WHERE account_id=? ORDER BY id DESC LIMIT 1
    `).get(accountId);
    if (latest?.data === serializedData) return false;
    if (!force && latest?.created_at) {
      const latestAt = Date.parse(String(latest.created_at).replace(' ', 'T') + 'Z');
      if (Number.isFinite(latestAt) && Date.now() - latestAt < VERSION_MIN_INTERVAL_MS) return false;
    }
  } else if (!force && latestMeta.created_at) {
    const latestAt = Date.parse(String(latestMeta.created_at).replace(' ', 'T') + 'Z');
    if (Number.isFinite(latestAt) && Date.now() - latestAt < VERSION_MIN_INTERVAL_MS) return false;
  }
  const createdAt = db.prepare("SELECT datetime('now') AS t").get().t;
  const inserted = db.prepare(
    'INSERT INTO user_data_versions (account_id,data,created_at) VALUES (?,?,?)'
  ).run(accountId, serializedData, createdAt);
  insertVersionSummary(db, inserted.lastInsertRowid, accountId, createdAt, serializedData);
  db.prepare(`
    DELETE FROM user_data_versions
    WHERE account_id=? AND id NOT IN (
      SELECT id FROM user_data_versions
      WHERE account_id=? ORDER BY id DESC LIMIT ?
    )
  `).run(accountId, accountId, MAX_VERSIONS_PER_WORKSPACE);
  return true;
}

function listVersionSummaries(db, accountId, limit) {
  const rows = db.prepare(`
    SELECT version_id, created_at, data_size, todos, students, staff, instructions
    FROM user_data_version_summaries
    WHERE account_id=?
    ORDER BY version_id DESC
    LIMIT ?
  `).all(accountId, limit);
  return rows.map(row => ({
    id: row.version_id,
    created_at: formatVersionCreatedAt(row.created_at),
    size: row.data_size,
    summary: {
      todos: row.todos || 0,
      students: row.students || 0,
      staff: row.staff || 0,
      instructions: row.instructions || 0,
    },
  }));
}

module.exports = {
  VERSION_MIN_INTERVAL_MS,
  MAX_VERSIONS_PER_WORKSPACE,
  versionSummaryFromSerialized,
  ensureVersionSnapshotSchema,
  backfillVersionSummaries,
  saveVersionSnapshot,
  listVersionSummaries,
};
