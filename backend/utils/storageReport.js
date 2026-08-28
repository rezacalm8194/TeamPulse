function tableExists(db, name) {
  return !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
  ).get(name);
}

function safeQuery(db, sql, fallback) {
  try {
    return db.prepare(sql).get();
  } catch {
    return fallback;
  }
}

function safeAll(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch {
    return [];
  }
}

function collectStorageReport(db) {
  const files = tableExists(db, 'shared_files')
    ? safeQuery(db, 'SELECT COUNT(*) AS count, IFNULL(SUM(size),0) AS bytes FROM shared_files', { count: 0, bytes: 0 })
    : { count: 0, bytes: 0 };

  const snapshots = tableExists(db, 'user_data_version_summaries')
    ? safeQuery(db, 'SELECT COUNT(*) AS count, IFNULL(SUM(data_size),0) AS bytes FROM user_data_version_summaries', { count: 0, bytes: 0 })
    : { count: 0, bytes: 0 };

  const parts = tableExists(db, 'user_data_parts')
    ? safeQuery(db, 'SELECT COUNT(*) AS count, IFNULL(SUM(octet_length(data)),0) AS bytes FROM user_data_parts', { count: 0, bytes: 0 })
    : { count: 0, bytes: 0 };
  const todoRows = tableExists(db, 'workspace_todos')
    ? safeQuery(db, 'SELECT COUNT(*) AS count, IFNULL(SUM(octet_length(payload)),0) AS bytes FROM workspace_todos', { count: 0, bytes: 0 })
    : { count: 0, bytes: 0 };

  const documents = tableExists(db, 'user_data')
    ? safeQuery(db, `
        SELECT
          COUNT(*) AS workspaces,
          IFNULL(SUM(CASE WHEN data LIKE '{"_layout"%' THEN 0 ELSE octet_length(data) END), 0) AS legacy_blob_bytes
        FROM user_data
        WHERE account_id <> '__admin_settings__'
      `, { workspaces: 0, legacy_blob_bytes: 0 })
    : { workspaces: 0, legacy_blob_bytes: 0 };

  return {
    generated_at: new Date().toISOString(),
    files: { count: Number(files.count) || 0, bytes: Number(files.bytes) || 0 },
    snapshots: { count: Number(snapshots.count) || 0, bytes: Number(snapshots.bytes) || 0 },
    documents: {
      workspaces: Number(documents.workspaces) || 0,
      parts_count: (Number(parts.count) || 0) + (Number(todoRows.count) || 0),
      parts_bytes: (Number(parts.bytes) || 0) + (Number(todoRows.bytes) || 0),
      legacy_blob_bytes: Number(documents.legacy_blob_bytes) || 0,
    },
    largest_files: tableExists(db, 'shared_files')
      ? safeAll(db, `
          SELECT id, name, size, owner_account_id, workspace_id
          FROM shared_files
          ORDER BY size DESC
          LIMIT 10
        `)
      : [],
    largest_parts: tableExists(db, 'user_data_parts')
      ? safeAll(db, tableExists(db, 'workspace_todos') ? `
          SELECT account_id,part_key,bytes FROM (
            SELECT account_id,part_key,octet_length(data) AS bytes FROM user_data_parts
            UNION ALL
            SELECT storage_key AS account_id,'todos (SQLite)' AS part_key,
              IFNULL(SUM(octet_length(payload)),0) AS bytes
            FROM workspace_todos GROUP BY storage_key
          ) ORDER BY bytes DESC LIMIT 10
        ` : `
          SELECT account_id, part_key, octet_length(data) AS bytes
          FROM user_data_parts
          ORDER BY bytes DESC
          LIMIT 10
        `)
      : [],
    largest_snapshot_workspaces: tableExists(db, 'user_data_version_summaries')
      ? safeAll(db, `
          SELECT account_id, COUNT(*) AS count, IFNULL(SUM(data_size),0) AS bytes
          FROM user_data_version_summaries
          GROUP BY account_id
          ORDER BY bytes DESC
          LIMIT 10
        `)
      : [],
  };
}

module.exports = { collectStorageReport };
