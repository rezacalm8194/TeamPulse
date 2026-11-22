#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { selectRetainedVersionIds } = require('../utils/versionSnapshots');

function parseArgs(argv) {
  const opts = { json: false, db: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--db=')) opts.db = arg.slice(5);
  }
  return opts;
}

function resolveDbPath(cliDb) {
  if (cliDb) return path.resolve(cliDb);
  const envPath = process.env.DB_PATH;
  if (envPath) return path.resolve(path.join(__dirname, '..'), envPath);
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch (_) {}
  const fromEnv = process.env.DB_PATH;
  return path.resolve(path.join(__dirname, '..'), fromEnv || './database/teampulse.db');
}

function tableExists(db, name) {
  return !!safeQuery(
    db,
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
    { ok: 0 },
    [name]
  ).ok;
}

function safeQuery(db, sql, fallback, params = []) {
  try {
    const row = params.length ? db.prepare(sql).get(...params) : db.prepare(sql).get();
    return row === undefined ? fallback : row;
  } catch {
    return fallback;
  }
}

function safeAll(db, sql, params = []) {
  try {
    return params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all();
  } catch {
    return [];
  }
}

function shortAccountId(id) {
  return String(id || '').slice(0, 8);
}

function fmtMb(bytes) {
  return (Number(bytes || 0) / (1024 * 1024)).toFixed(1);
}

function fileStatMb(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return null;
    return { bytes: st.size, mb: fmtMb(st.size) };
  } catch {
    return null;
  }
}

function scanDirectory(dirPath) {
  const out = { path: dirPath, files: 0, bytes: 0, exists: false };
  try {
    if (!fs.statSync(dirPath).isDirectory()) return out;
    out.exists = true;
    const stack = [dirPath];
    while (stack.length) {
      const cur = stack.pop();
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        const p = path.join(cur, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (ent.isFile()) {
          const st = fs.statSync(p);
          out.files += 1;
          out.bytes += st.size;
        }
      }
    }
  } catch {
    out.exists = false;
  }
  return out;
}

function backupDirsNearDb(dbPath) {
  const parent = path.dirname(dbPath);
  const base = path.basename(dbPath, path.extname(dbPath));
  const names = new Set([
    path.join(parent, 'snapshots'),
    path.join(parent, `${base}-snapshots`),
    path.join(parent, 'backup'),
    path.join(parent, 'backups'),
  ]);
  try {
    for (const ent of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const lower = ent.name.toLowerCase();
      if (lower.includes('snapshot') || lower.includes('backup') || lower === 'bak') {
        names.add(path.join(parent, ent.name));
      }
    }
  } catch (_) {}
  return [...names];
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function collectFileSizes(dbPath) {
  const wal = `${dbPath}-wal`;
  const shm = `${dbPath}-shm`;
  const main = fileStatMb(dbPath);
  const dirs = backupDirsNearDb(dbPath).map(scanDirectory);
  return {
    database: main || { bytes: 0, mb: '0.0' },
    wal: fileStatMb(wal) || { bytes: 0, mb: '0.0', missing: true },
    shm: fileStatMb(shm) || { bytes: 0, mb: '0.0', missing: true },
    backup_dirs: dirs.map(d => ({
      path: d.path,
      exists: d.exists,
      files: d.files,
      bytes: d.bytes,
      mb: fmtMb(d.bytes),
    })),
  };
}

function collectPragmas(db) {
  const pageSize = Number(safeQuery(db, 'PRAGMA page_size', { page_size: 0 }).page_size || 0);
  const pageCount = Number(safeQuery(db, 'PRAGMA page_count', { page_count: 0 }).page_count || 0);
  const freelist = Number(safeQuery(db, 'PRAGMA freelist_count', { freelist_count: 0 }).freelist_count || 0);
  const autoVacuum = safeQuery(db, 'PRAGMA auto_vacuum', { auto_vacuum: null }).auto_vacuum;
  const journalMode = safeQuery(db, 'PRAGMA journal_mode', { journal_mode: 'unknown' }).journal_mode;
  return {
    page_size: pageSize,
    page_count: pageCount,
    freelist_count: freelist,
    free_bytes: freelist * pageSize,
    free_mb: fmtMb(freelist * pageSize),
    logical_bytes: pageCount * pageSize,
    logical_mb: fmtMb(pageCount * pageSize),
    auto_vacuum: autoVacuum,
    journal_mode: journalMode,
  };
}

function collectDbstat(db) {
  try {
    const rows = safeAll(db, 'SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC');
    if (!rows.length) return { available: false, reason: 'dbstat خالی یا در دسترس نیست', objects: [] };
    return {
      available: true,
      objects: rows.map(r => ({
        name: r.name,
        bytes: Number(r.bytes) || 0,
        mb: fmtMb(r.bytes),
        rows: null,
      })),
    };
  } catch (e) {
    return { available: false, reason: String(e.message || e), objects: [] };
  }
}

function estimateObjectSizes(db) {
  const tables = safeAll(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const objects = [];
  for (const { name } of tables) {
    const cols = safeAll(db, `PRAGMA table_info(${quoteIdent(name)})`);
    const sumCols = cols
      .filter(c => {
        const t = String(c.type || '').toUpperCase();
        return !t || t.includes('TEXT') || t.includes('BLOB') || t.includes('CHAR') || t.includes('CLOB');
      })
      .map(c => `IFNULL(SUM(length(CAST(${quoteIdent(c.name)} AS BLOB))),0)`);
    const contentExpr = sumCols.length ? sumCols.join(' + ') : '0';
    const row = safeQuery(
      db,
      `SELECT COUNT(*) AS row_count, (${contentExpr}) AS content_bytes FROM ${quoteIdent(name)}`,
      { row_count: 0, content_bytes: 0 }
    );
    objects.push({
      name,
      bytes: Number(row.content_bytes) || 0,
      mb: fmtMb(row.content_bytes),
      rows: Number(row.row_count) || 0,
      estimate: true,
    });
  }
  const indexes = safeAll(
    db,
    "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
  );
  for (const idx of indexes) {
    objects.push({
      name: `${idx.tbl_name}»${idx.name}`,
      bytes: 0,
      mb: '0.0',
      rows: null,
      estimate: true,
      index_only: true,
    });
  }
  objects.sort((a, b) => b.bytes - a.bytes);
  return { available: false, reason: 'dbstat در دسترس نبود؛ تخمین از SUM(length) ستون‌های متنی', objects };
}

function rowCountsForTables(db, names) {
  const out = {};
  for (const name of names) {
    if (!tableExists(db, name)) {
      out[name] = null;
      continue;
    }
    const row = safeQuery(db, `SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`, { n: 0 });
    out[name] = Number(row.n) || 0;
  }
  return out;
}

function historyTableSpec(name) {
  const specs = {
    user_data_versions: { accountCol: 'account_id', dateCol: 'created_at', perRow: 'length(CAST(data AS BLOB))' },
    user_data_version_summaries: { accountCol: 'account_id', dateCol: 'created_at', perRow: 'IFNULL(data_size,0)' },
    user_data_parts: { accountCol: 'account_id', dateCol: null, perRow: 'length(CAST(data AS BLOB))' },
    user_data_version_part_blobs: { accountCol: 'account_id', dateCol: null, perRow: 'length(CAST(data AS BLOB))' },
    user_data_version_parts: { accountCol: null, dateCol: null, perRow: '0' },
    user_data_version_todo_blobs: { accountCol: 'account_id', dateCol: null, perRow: 'length(CAST(payload AS BLOB))' },
    user_data_version_todos: { accountCol: null, dateCol: null, perRow: '0' },
    user_data_version_business_blobs: { accountCol: 'account_id', dateCol: null, perRow: 'length(CAST(payload AS BLOB))' },
    user_data_version_business_rows: { accountCol: null, dateCol: null, perRow: '0' },
    workspace_todos: { accountCol: 'storage_key', dateCol: 'updated_at', perRow: 'length(CAST(payload AS BLOB))' },
    workspace_business_rows: { accountCol: 'storage_key', dateCol: 'updated_at', perRow: 'length(CAST(payload AS BLOB))' },
    todo_audit_events: { accountCol: 'storage_key', dateCol: 'created_at', perRow: 'length(CAST(payload_json AS BLOB))' },
    sync_events: { accountCol: 'account_id', dateCol: 'created_at', perRow: 'length(CAST(payload AS BLOB))' },
    user_data: { accountCol: 'account_id', dateCol: 'updated_at', perRow: 'length(CAST(data AS BLOB))' },
    shared_files: { accountCol: 'owner_account_id', dateCol: 'created_at', perRow: 'IFNULL(size,0)' },
  };
  return specs[name] || null;
}

function reportHistoryTable(db, tableName) {
  if (!tableExists(db, tableName)) {
    return { table: tableName, present: false };
  }
  const spec = historyTableSpec(tableName);
  if (!spec) {
    const generic = safeQuery(
      db,
      `SELECT COUNT(*) AS row_count FROM ${quoteIdent(tableName)}`,
      { row_count: 0 }
    );
    return { table: tableName, present: true, rows: Number(generic.row_count) || 0, note: 'بدون پیکربندی جزئی' };
  }
  const sizeRow = safeQuery(
    db,
    `SELECT COUNT(*) AS row_count, IFNULL(SUM(${spec.perRow}),0) AS data_bytes FROM ${quoteIdent(tableName)}`,
    { row_count: 0, data_bytes: 0 }
  );
  let oldest = null;
  let newest = null;
  if (spec.dateCol) {
    const range = safeQuery(
      db,
      `SELECT MIN(${quoteIdent(spec.dateCol)}) AS oldest, MAX(${quoteIdent(spec.dateCol)}) AS newest FROM ${quoteIdent(tableName)}`,
      { oldest: null, newest: null }
    );
    oldest = range.oldest;
    newest = range.newest;
  }
  let topAccounts = [];
  if (spec.accountCol && spec.perRow !== '0') {
    topAccounts = safeAll(
      db,
      `SELECT ${quoteIdent(spec.accountCol)} AS account_id, IFNULL(SUM(${spec.perRow}),0) AS bytes
       FROM ${quoteIdent(tableName)}
       GROUP BY ${quoteIdent(spec.accountCol)}
       ORDER BY bytes DESC
       LIMIT 10`
    ).map(r => ({
      account_id: shortAccountId(r.account_id),
      bytes: Number(r.bytes) || 0,
      mb: fmtMb(r.bytes),
    }));
  }
  const rowCounts = rowCountsForTables(db, [tableName]);
  return {
    table: tableName,
    present: true,
    rows: rowCounts[tableName],
    data_bytes: Number(sizeRow.data_bytes) || 0,
    data_mb: fmtMb(sizeRow.data_bytes),
    oldest,
    newest,
    top_accounts: topAccounts,
  };
}

function analyzeVersionRetention(db) {
  if (!tableExists(db, 'user_data_versions')) {
    return { present: false, accounts: [], totals: { versions: 0, should_keep: 0, extra: 0 } };
  }
  const rows = safeAll(
    db,
    'SELECT id, account_id, created_at FROM user_data_versions ORDER BY account_id, created_at DESC'
  );
  const byAccount = new Map();
  for (const row of rows) {
    const key = String(row.account_id || '');
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key).push(row);
  }
  const accounts = [];
  let totalVersions = 0;
  let totalKeep = 0;
  for (const [accountId, list] of byAccount) {
    totalVersions += list.length;
    const keep = selectRetainedVersionIds(list);
    totalKeep += keep.size;
    accounts.push({
      account_id: shortAccountId(accountId),
      versions: list.length,
      should_keep: keep.size,
      extra: Math.max(0, list.length - keep.size),
    });
  }
  accounts.sort((a, b) => b.extra - a.extra || b.versions - a.versions);
  return {
    present: true,
    accounts: accounts.slice(0, 20),
    totals: {
      versions: totalVersions,
      should_keep: totalKeep,
      extra: Math.max(0, totalVersions - totalKeep),
    },
  };
}

function orphanRows(db, sql) {
  const row = safeQuery(db, sql, { row_count: 0, bytes: 0 });
  return {
    present: true,
    rows: Number(row.row_count) || 0,
    bytes: Number(row.bytes) || 0,
    mb: fmtMb(row.bytes),
  };
}

function collectOrphanParts(db) {
  const out = {
    version_part_blobs: { present: false },
    version_todo_blobs: { present: false },
    version_business_blobs: { present: false },
    user_data_parts_missing_account: { present: false },
  };
  if (tableExists(db, 'user_data_version_part_blobs')) {
    out.version_part_blobs = orphanRows(
      db,
      `SELECT COUNT(*) AS row_count,
        IFNULL(SUM(length(CAST(b.data AS BLOB))),0) AS bytes
       FROM user_data_version_part_blobs b
       WHERE NOT EXISTS (
         SELECT 1 FROM user_data_version_parts p
         JOIN user_data_versions v ON v.id = p.version_id
         WHERE v.account_id = b.account_id AND p.data_hash = b.data_hash
       )`
    );
  }
  if (tableExists(db, 'user_data_version_todo_blobs')) {
    out.version_todo_blobs = orphanRows(
      db,
      `SELECT COUNT(*) AS row_count,
        IFNULL(SUM(length(CAST(b.payload AS BLOB))),0) AS bytes
       FROM user_data_version_todo_blobs b
       WHERE NOT EXISTS (
         SELECT 1 FROM user_data_version_todos t
         JOIN user_data_versions v ON v.id = t.version_id
         WHERE v.account_id = b.account_id AND t.todo_hash = b.todo_hash
       )`
    );
  }
  if (tableExists(db, 'user_data_version_business_blobs')) {
    out.version_business_blobs = orphanRows(
      db,
      `SELECT COUNT(*) AS row_count,
        IFNULL(SUM(length(CAST(b.payload AS BLOB))),0) AS bytes
       FROM user_data_version_business_blobs b
       WHERE NOT EXISTS (
         SELECT 1 FROM user_data_version_business_rows r
         JOIN user_data_versions v ON v.id = r.version_id
         WHERE v.account_id = b.account_id
           AND r.collection_key = b.collection_key
           AND r.row_hash = b.row_hash
       )`
    );
  }
  if (tableExists(db, 'user_data_parts') && tableExists(db, 'accounts')) {
    out.user_data_parts_missing_account = orphanRows(
      db,
      `SELECT COUNT(*) AS row_count,
        IFNULL(SUM(length(CAST(p.data AS BLOB))),0) AS bytes
       FROM user_data_parts p
       WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = p.account_id)`
    );
  }
  return out;
}

function ownerFromStorageKeyExpr(column) {
  return `CASE WHEN instr(${column}, ':') > 0 THEN substr(${column}, 1, instr(${column}, ':') - 1) ELSE ${column} END`;
}

function sumTextBlobExpr(db, table) {
  const cols = safeAll(db, `PRAGMA table_info(${quoteIdent(table)})`);
  const parts = cols
    .filter(c => {
      const t = String(c.type || '').toUpperCase();
      return !t || t.includes('TEXT') || t.includes('BLOB') || t.includes('CHAR') || t.includes('INT') || t.includes('REAL');
    })
    .map(c => `IFNULL(length(CAST(${quoteIdent(c.name)} AS BLOB)),0)`);
  return parts.length ? parts.join(' + ') : '0';
}

function collectStaleData(db) {
  const staleByTable = [];
  if (!tableExists(db, 'accounts')) return { tables: staleByTable };

  const candidateTables = safeAll(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).map(r => r.name);

  for (const table of candidateTables) {
    const cols = safeAll(db, `PRAGMA table_info(${quoteIdent(table)})`);
    if (!cols.some(c => c.name === 'account_id')) continue;
    const perRow = sumTextBlobExpr(db, table);
    const row = safeQuery(
      db,
      `SELECT COUNT(*) AS row_count, IFNULL(SUM(${perRow}),0) AS bytes
       FROM ${quoteIdent(table)} t
       WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = t.account_id)`,
      { row_count: 0, bytes: 0 }
    );
    if (Number(row.row_count) > 0) {
      staleByTable.push({
        table,
        reason: 'account_id خارج از accounts',
        rows: Number(row.row_count) || 0,
        bytes: Number(row.bytes) || 0,
        mb: fmtMb(row.bytes),
      });
    }
  }

  if (tableExists(db, 'workspace_todos') && tableExists(db, 'accounts')) {
    const keyExpr = ownerFromStorageKeyExpr('t.storage_key');
    const row = safeQuery(
      db,
      `SELECT COUNT(*) AS row_count,
        IFNULL(SUM(length(CAST(payload AS BLOB))),0) AS bytes
       FROM workspace_todos t
       WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = ${keyExpr})`,
      { row_count: 0, bytes: 0 }
    );
    if (Number(row.row_count) > 0) {
      staleByTable.push({
        table: 'workspace_todos',
        reason: 'storage_key بدون حساب',
        rows: Number(row.row_count) || 0,
        bytes: Number(row.bytes) || 0,
        mb: fmtMb(row.bytes),
      });
    }
  }

  if (tableExists(db, 'account_workspaces')) {
    const hasDeleted = safeAll(db, 'PRAGMA table_info(account_workspaces)').some(c => c.name === 'deleted_at');
    if (hasDeleted && tableExists(db, 'workspace_todos')) {
      const row = safeQuery(
        db,
        `SELECT COUNT(*) AS row_count,
          IFNULL(SUM(length(CAST(t.payload AS BLOB))),0) AS bytes
         FROM workspace_todos t
         WHERE EXISTS (
           SELECT 1 FROM account_workspaces w
           WHERE w.deleted_at IS NOT NULL
             AND w.owner_account_id = ${ownerFromStorageKeyExpr('t.storage_key')}
             AND (instr(t.storage_key, ':') = 0 OR w.workspace_id = substr(t.storage_key, instr(t.storage_key, ':') + 1))
         )`,
        { row_count: 0, bytes: 0 }
      );
      if (Number(row.row_count) > 0) {
        staleByTable.push({
          table: 'workspace_todos',
          reason: 'میزکار در سطل بازیافت (deleted_at)',
          rows: Number(row.row_count) || 0,
          bytes: Number(row.bytes) || 0,
          mb: fmtMb(row.bytes),
        });
      }
    }
  }

  return { tables: staleByTable };
}

function buildSummaryLines(dbFileBytes, dbstat, historyTables, fileSizes, pragmas) {
  const total = Number(dbFileBytes) || 1;
  const buckets = [];

  if (dbstat.objects && dbstat.objects.length) {
    dbstat.objects.slice(0, 8).forEach(o => {
      buckets.push({ label: o.name, bytes: Number(o.bytes) || 0 });
    });
  }

  for (const h of historyTables) {
    if (h.present && h.data_bytes) {
      buckets.push({ label: h.table, bytes: Number(h.data_bytes) || 0 });
    }
  }

  if (Number(fileSizes.wal.bytes) > 0) {
    buckets.push({ label: 'teampulse.db-wal', bytes: Number(fileSizes.wal.bytes) });
  }
  if (Number(pragmas.free_bytes) > 0) {
    buckets.push({ label: 'freelist (SQLite)', bytes: Number(pragmas.free_bytes) });
  }

  const merged = new Map();
  for (const b of buckets) {
    if (!b.bytes) continue;
    merged.set(b.label, (merged.get(b.label) || 0) + b.bytes);
  }

  const ranked = [...merged.entries()]
    .map(([label, bytes]) => ({ label, bytes, pct: ((bytes / total) * 100).toFixed(1) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);

  const lines = ranked.map((r, i) =>
    `${i + 1}) ${r.label}: ${fmtMb(r.bytes)} MB (${r.pct}% از فایل اصلی)`
  );
  while (lines.length < 5) lines.push(`${lines.length + 1}) —`);
  return lines.slice(0, 5);
}

const HISTORY_TABLE_NAMES = [
  'user_data_versions',
  'user_data_version_summaries',
  'user_data_parts',
  'user_data_version_part_blobs',
  'user_data_version_parts',
  'user_data_version_todo_blobs',
  'user_data_version_todos',
  'user_data_version_business_blobs',
  'user_data_version_business_rows',
  'workspace_todos',
  'workspace_business_rows',
  'todo_audit_events',
  'sync_events',
  'user_data',
  'shared_files',
];

function buildDbSizeReport(db, dbPath) {
  const fileSizes = collectFileSizes(dbPath);
  const pragmas = collectPragmas(db);
  const dbstatProbe = collectDbstat(db);
  let dbstat = dbstatProbe;
  if (!dbstat.available) {
    const est = estimateObjectSizes(db);
    dbstat = { available: false, reason: dbstatProbe.reason || est.reason, objects: est.objects };
  }

  const tableRowCounts = rowCountsForTables(db, dbstat.objects.map(o => o.name.split('»')[0]));
  dbstat.objects = dbstat.objects.map(o => {
    const base = o.name.includes('»') ? o.name.split('»')[0] : o.name;
    if (o.rows == null && tableRowCounts[base] != null) return { ...o, rows: tableRowCounts[base] };
    return o;
  });

  const top20 = dbstat.objects.slice(0, 20).map(o => ({
    name: o.name,
    bytes: o.bytes,
    mb: o.mb || fmtMb(o.bytes),
    rows: o.rows,
    estimate: !!o.estimate,
    index_only: !!o.index_only,
  }));

  const historyTables = HISTORY_TABLE_NAMES.map(name => reportHistoryTable(db, name));
  const versionRetention = analyzeVersionRetention(db);
  const orphanParts = collectOrphanParts(db);
  const staleData = collectStaleData(db);

  const dbBytes = fileSizes.database.bytes || 0;
  const summaryLines = buildSummaryLines(dbBytes, dbstat, historyTables, fileSizes, pragmas);

  return {
    generated_at: new Date().toISOString(),
    db_path: dbPath,
    files: fileSizes,
    pragmas,
    dbstat: { available: dbstat.available, reason: dbstat.reason || null, top20, total_objects: dbstat.objects.length },
    history_tables: historyTables,
    version_retention: versionRetention,
    orphan_parts: orphanParts,
    stale_data: staleData,
    summary_lines: summaryLines,
  };
}

function printReport(report) {
  const w = (line = '') => { process.stdout.write(`${line}\n`); };
  w('=== گزارش حجم پایگاه داده TeamPulse (فقط‌خواندنی) ===');
  w(`مسیر: ${report.db_path}`);
  w(`زمان: ${report.generated_at}`);
  w('');
  w('--- ۱) فایل‌ها ---');
  w(`  teampulse.db: ${report.files.database.mb} MB`);
  w(`  teampulse.db-wal: ${report.files.wal.missing ? 'ندارد' : `${report.files.wal.mb} MB`}`);
  w(`  teampulse.db-shm: ${report.files.shm.missing ? 'ندارد' : `${report.files.shm.mb} MB`}`);
  for (const dir of report.files.backup_dirs) {
    w(`  ${dir.path}: ${dir.exists ? `${dir.files} فایل، ${dir.mb} MB` : 'ندارد'}`);
  }
  w('');
  w('--- ۲) PRAGMA ---');
  w(`  page_size=${report.pragmas.page_size}  page_count=${report.pragmas.page_count}  freelist=${report.pragmas.freelist_count}`);
  w(`  فضای خالی: ${report.pragmas.free_mb} MB  journal_mode=${report.pragmas.journal_mode}  auto_vacuum=${report.pragmas.auto_vacuum}`);
  w('');
  w('--- ۳) حجم اشیاء (dbstat یا تخمین) ---');
  if (report.dbstat.reason) w(`  ${report.dbstat.reason}`);
  for (const o of report.dbstat.top20) {
    const rc = o.rows == null ? '' : `  rows=${o.rows}`;
    w(`  ${o.mb} MB  ${o.name}${rc}`);
  }
  w('');
  w('--- ۴) جداول نسخه / بکاپ / تاریخچه ---');
  for (const h of report.history_tables) {
    if (!h.present) {
      w(`  ${h.table}: ندارد`);
      continue;
    }
    const range = h.oldest || h.newest ? `  ${h.oldest || '?'} .. ${h.newest || '?'}` : '';
    w(`  ${h.table}: rows=${h.rows}  data=${h.data_mb ?? '?'} MB${range}`);
    if (h.top_accounts && h.top_accounts.length) {
      const tops = h.top_accounts.map(t => `${t.account_id}:${t.mb}`).join(', ');
      w(`    top accounts: ${tops}`);
    }
  }
  w('');
  w('--- ۵) نسخه‌های ساعتی (نگه‌داری) ---');
  if (!report.version_retention.present) {
    w('  user_data_versions: ندارد');
  } else {
    w(`  کل نسخه‌ها=${report.version_retention.totals.versions}  باید بماند=${report.version_retention.totals.should_keep}  اضافه=${report.version_retention.totals.extra}`);
    for (const a of report.version_retention.accounts.slice(0, 10)) {
      w(`  ${a.account_id}: versions=${a.versions} keep=${a.should_keep} extra=${a.extra}`);
    }
  }
  w('');
  w('--- ۶) partهای بدون مرجع (orphan) ---');
  const op = report.orphan_parts;
  for (const key of Object.keys(op)) {
    const v = op[key];
    if (!v || v.present === false) {
      w(`  ${key}: ندارد`);
      continue;
    }
    const rows = v.rows != null ? v.rows : v.row_count;
    const mb = v.mb || fmtMb(v.bytes);
    w(`  ${key}: rows=${rows}  ${mb} MB`);
  }
  w('');
  w('--- ۷) داده حساب/میزکار نامعتبر ---');
  if (!report.stale_data.tables.length) w('  موردی گزارش نشد');
  else {
    for (const t of report.stale_data.tables) {
      w(`  ${t.table} (${t.reason}): rows=${t.rows}  ${t.mb} MB`);
    }
  }
  w('');
  w('--- جمع‌بندی (۵ خط) ---');
  for (const line of report.summary_lines.slice(0, 5)) w(`  ${line}`);
}

function main() {
  const opts = parseArgs(process.argv);
  const dbPath = resolveDbPath(opts.db);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const report = buildDbSizeReport(db, dbPath);
  db.close();
  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printReport(report);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`${e.stack || e.message || e}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildDbSizeReport,
  collectPragmas,
  safeQuery,
  safeAll,
  tableExists,
  shortAccountId,
  fmtMb,
};