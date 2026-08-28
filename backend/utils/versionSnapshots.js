const { createHash } = require('crypto');

const VERSION_PARTS_MARKER = '{"_layout":"version_parts"}';

// Legacy version blobs stay in user_data_versions. Part-layout versions keep a
// tiny marker there, a hash manifest in user_data_version_parts, and deduped
// content in user_data_version_part_blobs. Listing reads summaries only.

const VERSION_MIN_INTERVAL_MS = 60 * 60 * 1000;
const VERSION_RETENTION = Object.freeze({
  keepNewest: 3,
  hourly: 24,
  daily: 7,
  weekly: 4,
  monthly: 12,
});
const MAX_VERSIONS_PER_WORKSPACE =
  VERSION_RETENTION.keepNewest +
  VERSION_RETENTION.hourly +
  VERSION_RETENTION.daily +
  VERSION_RETENTION.weekly +
  VERSION_RETENTION.monthly;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

function parseSnapshotMs(createdAt) {
  const ms = Date.parse(String(createdAt || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : 0;
}

function isoWeekKey(ms) {
  const date = new Date(ms);
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const cursor = new Date(utc);
  const dayNum = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(cursor.getUTCFullYear(), 0, 1);
  const week = Math.ceil((((cursor.getTime() - yearStart) / DAY_MS) + 1) / 7);
  return `${cursor.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function selectRetainedVersionIds(rows, nowMs = Date.now()) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const delta = parseSnapshotMs(b.created_at) - parseSnapshotMs(a.created_at);
    return delta || Number(b.id) - Number(a.id);
  });
  const keep = new Set();
  if (!sorted.length) return keep;

  for (let i = 0; i < Math.min(VERSION_RETENTION.keepNewest, sorted.length); i++) {
    keep.add(sorted[i].id);
  }

  const hourlySeen = new Set();
  const dailySeen = new Set();
  const weeklySeen = new Set();
  const monthlySeen = new Set();
  const now = new Date(nowMs);

  for (const row of sorted) {
    const ms = parseSnapshotMs(row.created_at);
    if (!ms) continue;

    if (nowMs - ms <= VERSION_RETENTION.hourly * HOUR_MS) {
      const hourBucket = Math.floor(ms / HOUR_MS);
      if (!hourlySeen.has(hourBucket)) {
        hourlySeen.add(hourBucket);
        keep.add(row.id);
      }
    }

    if (nowMs - ms <= VERSION_RETENTION.daily * DAY_MS) {
      const day = new Date(ms);
      const dayKey = `${day.getUTCFullYear()}-${day.getUTCMonth()}-${day.getUTCDate()}`;
      if (!dailySeen.has(dayKey)) {
        dailySeen.add(dayKey);
        keep.add(row.id);
      }
    }

    if (nowMs - ms <= VERSION_RETENTION.weekly * 7 * DAY_MS) {
      const weekKey = isoWeekKey(ms);
      if (!weeklySeen.has(weekKey)) {
        weeklySeen.add(weekKey);
        keep.add(row.id);
      }
    }

    const then = new Date(ms);
    const monthsAgo = (now.getUTCFullYear() - then.getUTCFullYear()) * 12
      + (now.getUTCMonth() - then.getUTCMonth());
    if (monthsAgo >= 0 && monthsAgo < VERSION_RETENTION.monthly) {
      const monthKey = `${then.getUTCFullYear()}-${then.getUTCMonth()}`;
      if (!monthlySeen.has(monthKey)) {
        monthlySeen.add(monthKey);
        keep.add(row.id);
      }
    }
  }

  if (keep.size <= MAX_VERSIONS_PER_WORKSPACE) return keep;
  const capped = new Set();
  for (const row of sorted) {
    if (!keep.has(row.id)) continue;
    capped.add(row.id);
    if (capped.size >= MAX_VERSIONS_PER_WORKSPACE) break;
  }
  return capped;
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
    CREATE TABLE IF NOT EXISTS user_data_version_part_blobs (
      account_id TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (account_id, data_hash)
    );
    CREATE TABLE IF NOT EXISTS user_data_version_parts (
      version_id INTEGER NOT NULL,
      part_key TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      PRIMARY KEY (version_id, part_key),
      FOREIGN KEY (version_id) REFERENCES user_data_versions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_data_version_parts_hash
      ON user_data_version_parts(data_hash);
    DROP TRIGGER IF EXISTS trg_user_data_versions_cleanup_part_blobs;
    CREATE TRIGGER trg_user_data_versions_cleanup_part_blobs
    AFTER DELETE ON user_data_versions
    BEGIN
      DELETE FROM user_data_version_part_blobs
      WHERE account_id=OLD.account_id
        AND NOT EXISTS (
          SELECT 1
          FROM user_data_version_parts p
          JOIN user_data_versions v ON v.id=p.version_id
          WHERE v.account_id=OLD.account_id
            AND p.data_hash=user_data_version_part_blobs.data_hash
        );
    END
  `);
}

function versionPartsSummary(db, accountId, hashes) {
  const keys = Object.keys(hashes || {});
  const sizeRow = db.prepare(`
    SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS n
    FROM user_data_parts WHERE account_id=?
  `).get(accountId);
  const counts = { todos: 0, students: 0, staff: 0, instructions: 0 };
  const countPart = db.prepare(
    'SELECT data FROM user_data_parts WHERE account_id=? AND part_key=?'
  );
  Object.keys(counts).forEach(key => {
    const row = countPart.get(accountId, key);
    if (!row) return;
    try {
      const parsed = JSON.parse(row.data || '[]');
      counts[key] = Array.isArray(parsed) ? parsed.length : 0;
    } catch (_) { counts[key] = 0; }
  });
  const canonical = keys.sort().map(key => `${key}:${hashes[key]}`).join('|');
  return {
    data_size: Number(sizeRow?.n || 0),
    data_hash: hashSerialized(canonical),
    ...counts,
  };
}

function insertSummaryValues(db, versionId, accountId, createdAt, summary) {
  db.prepare(`
    INSERT INTO user_data_version_summaries (
      version_id, account_id, created_at, data_size, data_hash,
      todos, students, staff, instructions
    ) VALUES (?,?,?,?,?,?,?,?,?)
  `).run(versionId, accountId, createdAt, summary.data_size, summary.data_hash,
    summary.todos, summary.students, summary.staff, summary.instructions);
}

function insertVersionSummary(db, versionId, accountId, createdAt, serializedData) {
  const summary = versionSummaryFromSerialized(serializedData);
  insertSummaryValues(db, versionId, accountId, createdAt, summary);
  return summary;
}

function saveVersionSnapshotParts(db, accountId, { force = false } = {}) {
  const rows = db.prepare(
    'SELECT part_key,data_hash FROM user_data_parts WHERE account_id=? ORDER BY part_key'
  ).all(accountId);
  if (!rows.length) return false;
  const hashes = Object.fromEntries(rows.map(row => [row.part_key, row.data_hash]));
  const summary = versionPartsSummary(db, accountId, hashes);
  const latest = db.prepare(`
    SELECT version_id,created_at,data_hash FROM user_data_version_summaries
    WHERE account_id=? ORDER BY version_id DESC LIMIT 1
  `).get(accountId);
  if (latest?.data_hash === summary.data_hash) return false;
  if (!force && latest?.created_at && snapshotAgeMs(latest.created_at) < VERSION_MIN_INTERVAL_MS) return false;
  if (!latest && !force && !isVersionSnapshotDue(db, accountId)) return false;

  const storedHashes = new Set(db.prepare(
    'SELECT data_hash FROM user_data_version_part_blobs WHERE account_id=?'
  ).all(accountId).map(row => row.data_hash));
  const changedKeys = new Set(rows
    .filter(row => !storedHashes.has(row.data_hash))
    .map(row => row.part_key));
  const changedData = new Map();
  if (changedKeys.size) {
    const placeholders = [...changedKeys].map(() => '?').join(',');
    db.prepare(`
      SELECT part_key,data FROM user_data_parts
      WHERE account_id=? AND part_key IN (${placeholders})
    `).all(accountId, ...changedKeys).forEach(row => changedData.set(row.part_key, row.data));
  }

  const save = db.transaction(() => {
    const createdAt = db.prepare("SELECT datetime('now') AS t").get().t;
    const inserted = db.prepare(
      'INSERT INTO user_data_versions (account_id,data,created_at) VALUES (?,?,?)'
    ).run(accountId, VERSION_PARTS_MARKER, createdAt);
    const addBlob = db.prepare(`
      INSERT OR IGNORE INTO user_data_version_part_blobs(account_id,data_hash,data)
      VALUES (?,?,?)
    `);
    const addRef = db.prepare(`
      INSERT INTO user_data_version_parts(version_id,part_key,data_hash) VALUES (?,?,?)
    `);
    for (const row of rows) {
      if (changedKeys.has(row.part_key)) {
        const data = changedData.get(row.part_key);
        if (data === undefined) throw new Error(`version_part_missing:${row.part_key}`);
        addBlob.run(accountId, row.data_hash, data);
      }
      addRef.run(inserted.lastInsertRowid, row.part_key, row.data_hash);
    }
    insertSummaryValues(db, inserted.lastInsertRowid, accountId, createdAt, summary);
  });
  save();
  pruneVersionSnapshots(db, accountId);
  return true;
}

function loadVersionSnapshot(db, accountId, versionId) {
  const version = db.prepare(
    'SELECT id,data FROM user_data_versions WHERE id=? AND account_id=?'
  ).get(versionId, accountId);
  if (!version) return null;
  if (String(version.data || '').trim() !== VERSION_PARTS_MARKER) {
    try { return JSON.parse(version.data); } catch (_) { return undefined; }
  }
  const rows = db.prepare(`
    SELECT p.part_key,b.data
    FROM user_data_version_parts p
    JOIN user_data_version_part_blobs b
      ON b.account_id=? AND b.data_hash=p.data_hash
    WHERE p.version_id=?
  `).all(accountId, version.id);
  const refs = db.prepare(
    'SELECT COUNT(*) AS n FROM user_data_version_parts WHERE version_id=?'
  ).get(version.id).n;
  if (!refs || rows.length !== refs) return undefined;
  const data = {};
  for (const row of rows) {
    let value;
    try { value = JSON.parse(row.data); } catch (_) { return undefined; }
    if (row.part_key === '__scalars__') Object.assign(data, value && typeof value === 'object' ? value : {});
    else data[row.part_key] = Array.isArray(value) ? value : [];
  }
  return data;
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

function snapshotAgeMs(createdAt) {
  const latestAt = parseSnapshotMs(createdAt);
  return latestAt ? Date.now() - latestAt : Infinity;
}

function isVersionSnapshotDue(db, accountId, { force = false } = {}) {
  if (force) return true;
  const latestMeta = db.prepare(`
    SELECT created_at
    FROM user_data_version_summaries
    WHERE account_id=?
    ORDER BY version_id DESC
    LIMIT 1
  `).get(accountId);
  if (latestMeta?.created_at) return snapshotAgeMs(latestMeta.created_at) >= VERSION_MIN_INTERVAL_MS;
  const latest = db.prepare(`
    SELECT created_at FROM user_data_versions
    WHERE account_id=? ORDER BY id DESC LIMIT 1
  `).get(accountId);
  if (!latest?.created_at) return true;
  return snapshotAgeMs(latest.created_at) >= VERSION_MIN_INTERVAL_MS;
}

function pruneVersionSnapshots(db, accountId, nowMs = Date.now()) {
  const rows = db.prepare(
    'SELECT id, created_at FROM user_data_versions WHERE account_id=?'
  ).all(accountId);
  if (rows.length <= VERSION_RETENTION.keepNewest) return 0;
  const keep = selectRetainedVersionIds(rows, nowMs);
  if (!keep.size) return 0;
  const ids = [...keep];
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(
    `DELETE FROM user_data_versions WHERE account_id=? AND id NOT IN (${placeholders})`
  ).run(accountId, ...ids);
  if (result.changes) {
    db.prepare(`
      DELETE FROM user_data_version_part_blobs
      WHERE account_id=? AND NOT EXISTS (
        SELECT 1
        FROM user_data_version_parts p
        JOIN user_data_versions v ON v.id=p.version_id
        WHERE v.account_id=?
          AND p.data_hash=user_data_version_part_blobs.data_hash
      )
    `).run(accountId, accountId);
  }
  return result.changes || 0;
}

function pruneAllVersionSnapshots(db, nowMs = Date.now()) {
  const accounts = db.prepare(
    'SELECT DISTINCT account_id FROM user_data_versions'
  ).all();
  if (!accounts.length) return 0;
  let deleted = 0;
  const run = db.transaction(() => {
    for (const row of accounts) {
      deleted += pruneVersionSnapshots(db, row.account_id, nowMs);
    }
  });
  run();
  return deleted;
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
    if (!force && latest?.created_at && snapshotAgeMs(latest.created_at) < VERSION_MIN_INTERVAL_MS) return false;
  } else if (!force && latestMeta.created_at && snapshotAgeMs(latestMeta.created_at) < VERSION_MIN_INTERVAL_MS) {
    return false;
  }
  const createdAt = db.prepare("SELECT datetime('now') AS t").get().t;
  const inserted = db.prepare(
    'INSERT INTO user_data_versions (account_id,data,created_at) VALUES (?,?,?)'
  ).run(accountId, serializedData, createdAt);
  insertVersionSummary(db, inserted.lastInsertRowid, accountId, createdAt, serializedData);
  pruneVersionSnapshots(db, accountId);
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
  VERSION_PARTS_MARKER,
  VERSION_MIN_INTERVAL_MS,
  VERSION_RETENTION,
  MAX_VERSIONS_PER_WORKSPACE,
  versionSummaryFromSerialized,
  selectRetainedVersionIds,
  ensureVersionSnapshotSchema,
  backfillVersionSummaries,
  saveVersionSnapshot,
  saveVersionSnapshotParts,
  loadVersionSnapshot,
  isVersionSnapshotDue,
  pruneVersionSnapshots,
  pruneAllVersionSnapshots,
  listVersionSummaries,
};
