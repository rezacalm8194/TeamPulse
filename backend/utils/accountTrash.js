'use strict';

// Account recycle bin (parallel to workspaceTrash).
//
// Admin delete used to wipe every row and file immediately. Now it only sets
// accounts.deleted_at for ACCOUNT_TRASH_RETENTION_DAYS; purge runs the old
// hard delete after the window. Data and files stay until then.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { isProtectedAccount } = require('./protectedAdmin');
const { collectAccountAppBackup } = require('./userBackup');

const ACCOUNT_TRASH_RETENTION_DAYS = 30;
const ACCOUNT_TRASH_RETENTION_MS = ACCOUNT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const PURGED_BACKUP_RETENTION_DAYS = 90;
const PURGED_BACKUP_RETENTION_MS = PURGED_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const PURGE_BACKUP_REUSE_MS = 24 * 60 * 60 * 1000;
const PURGED_BACKUP_DIR = path.join(__dirname, '..', 'database', 'purged-accounts');

const schemaReady = new WeakSet();

const ACCOUNT_DEACTIVATED_MESSAGE = 'این حساب غیرفعال شده است؛ با پشتیبانی تماس بگیرید';

function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function backupFilenameStamp(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function ensurePurgedBackupDir() {
  if (!fs.existsSync(PURGED_BACKUP_DIR)) {
    fs.mkdirSync(PURGED_BACKUP_DIR, { recursive: true });
  }
  return PURGED_BACKUP_DIR;
}

function parseSqliteTimeMs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value).replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

function recentPrePurgeBackupPath(accountId, { now = Date.now(), backupDir = null, minMtimeMs = null } = {}) {
  const dir = backupDir || PURGED_BACKUP_DIR;
  if (!fs.existsSync(dir)) return null;
  const prefix = `${accountId}-`;
  const cutoff = now - PURGE_BACKUP_REUSE_MS;
  let newestPath = null;
  let newestMtime = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith('.json.gz')) continue;
    const full = path.join(dir, name);
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(full).mtimeMs; } catch { continue; }
    if (mtimeMs < cutoff) continue;
    if (minMtimeMs != null && Number.isFinite(minMtimeMs) && mtimeMs < minMtimeMs) continue;
    if (mtimeMs > newestMtime) {
      newestMtime = mtimeMs;
      newestPath = full;
    }
  }
  return newestPath;
}

function ensurePrePurgeAccountBackup(db, accountId, { now = Date.now(), logger = null, backupDir = null } = {}) {
  ensureAccountTrashSchema(db);
  const deletedAtMs = parseSqliteTimeMs(
    db.prepare('SELECT deleted_at FROM accounts WHERE id=?').get(accountId)?.deleted_at
  );
  const existing = recentPrePurgeBackupPath(accountId, {
    now,
    backupDir: backupDir || PURGED_BACKUP_DIR,
    minMtimeMs: deletedAtMs,
  });
  if (existing) {
    logger?.info?.('account_pre_purge_backup_reused', { accountId, filePath: existing });
    return existing;
  }
  return writePrePurgeAccountBackup(db, accountId, { now, logger, backupDir });
}

function writePrePurgeAccountBackup(db, accountId, { now = Date.now(), logger = null, backupDir = null } = {}) {
  const account = db.prepare(`
    SELECT id, name, email, business_name, business_type, plan, created_at
    FROM accounts WHERE id=?
  `).get(accountId);
  if (!account) throw new Error('account_not_found');
  const exportedAt = new Date(now).toISOString();
  const backup = collectAccountAppBackup(db, account, exportedAt);
  const dir = backupDir || ensurePurgedBackupDir();
  const filename = `${accountId}-${backupFilenameStamp(now)}.json.gz`;
  const filePath = path.join(dir, filename);
  try {
    const gzip = zlib.gzipSync(Buffer.from(JSON.stringify(backup), 'utf8'));
    fs.writeFileSync(filePath, gzip);
    logger?.info?.('account_pre_purge_backup_written', { accountId, filePath });
    return filePath;
  } catch (error) {
    logger?.error?.('account_pre_purge_backup_failed', { accountId, error });
    throw error;
  }
}

function purgeOldPrePurgeAccountBackups({ now = Date.now(), logger = null, backupDir = null } = {}) {
  const dir = backupDir || PURGED_BACKUP_DIR;
  if (!fs.existsSync(dir)) return 0;
  const cutoff = now - PURGED_BACKUP_RETENTION_MS;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json.gz')) continue;
    const full = path.join(dir, name);
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(full).mtimeMs; } catch { continue; }
    if (mtimeMs > cutoff) continue;
    try {
      fs.unlinkSync(full);
      removed += 1;
    } catch (error) {
      logger?.error?.('purged_account_backup_cleanup_failed', { file: full, error });
    }
  }
  return removed;
}

function ensureAccountTrashSchema(db) {
  if (schemaReady.has(db)) return;
  if (!hasTable(db, 'accounts')) return;
  const columns = db.prepare('PRAGMA table_info(accounts)').all();
  if (!columns.some(column => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE accounts ADD COLUMN deleted_at TEXT');
  }
  if (!columns.some(column => column.name === 'deleted_by')) {
    db.exec('ALTER TABLE accounts ADD COLUMN deleted_by TEXT');
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_deleted
    ON accounts(deleted_at) WHERE deleted_at IS NOT NULL`);
  schemaReady.add(db);
}

function ownerAccountIdFromStorageKey(storageKey) {
  const s = String(storageKey || '');
  const marker = '::workspace::';
  const i = s.indexOf(marker);
  return i >= 0 ? s.slice(0, i) : s;
}

function isAccountTrashed(db, accountId) {
  if (!accountId) return false;
  ensureAccountTrashSchema(db);
  const row = db.prepare('SELECT deleted_at FROM accounts WHERE id=?').get(accountId);
  return !!(row && row.deleted_at);
}

function isAccountActive(db, accountId) {
  return !isAccountTrashed(db, accountId);
}

function trashAccount(db, accountId, adminId, { now = Date.now() } = {}) {
  ensureAccountTrashSchema(db);
  const result = db.prepare(`
    UPDATE accounts
    SET deleted_at=?, deleted_by=?, updated_at=datetime('now')
    WHERE id=? AND deleted_at IS NULL
  `).run(sqlTime(now), adminId || null, accountId);
  return !!result.changes;
}

function restoreAccount(db, accountId) {
  ensureAccountTrashSchema(db);
  const result = db.prepare(`
    UPDATE accounts
    SET deleted_at=NULL, deleted_by=NULL, updated_at=datetime('now')
    WHERE id=? AND deleted_at IS NOT NULL
  `).run(accountId);
  return !!result.changes;
}

function daysRemaining(deletedAt, now = Date.now()) {
  const deletedMs = Date.parse(String(deletedAt).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(deletedMs)) return null;
  return Math.max(0, Math.ceil((deletedMs + ACCOUNT_TRASH_RETENTION_MS - now) / (24 * 60 * 60 * 1000)));
}

function listTrashedAccounts(db, { now = Date.now() } = {}) {
  ensureAccountTrashSchema(db);
  const rows = db.prepare(`
    SELECT id, email, name, deleted_at, deleted_by
    FROM accounts
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `).all();
  const clientStmt = hasTable(db, 'clients')
    ? db.prepare('SELECT COUNT(*) AS n FROM clients WHERE account_id=?')
    : null;
  const workspaceStmt = hasTable(db, 'account_workspaces')
    ? db.prepare('SELECT COUNT(*) AS n FROM account_workspaces WHERE owner_account_id=?')
    : null;
  return rows.map(row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    deleted_at: row.deleted_at,
    deleted_by: row.deleted_by,
    days_remaining: daysRemaining(row.deleted_at, now),
    purge_at: (() => {
      const deletedMs = Date.parse(String(row.deleted_at).replace(' ', 'T') + 'Z');
      return Number.isFinite(deletedMs) ? sqlTime(deletedMs + ACCOUNT_TRASH_RETENTION_MS) : null;
    })(),
    client_count: clientStmt ? Number(clientStmt.get(row.id).n || 0) : 0,
    workspace_count: workspaceStmt ? Number(workspaceStmt.get(row.id).n || 0) : 0,
  }));
}

function sharedStorageKeysForAccount(db, accountId) {
  if (!hasTable(db, 'shared_files')) return [];
  return db.prepare(`
    SELECT storage_key FROM shared_files
    WHERE owner_account_id=?
      AND storage_key IS NOT NULL
      AND trim(storage_key) <> ''
  `).all(accountId).map(row => row.storage_key);
}

function deleteCapturedSharedFiles(storageDriver, storageKeys, { accountId, logger } = {}) {
  if (!storageDriver?.deleteSync || !storageKeys.length) return;
  for (const storageKey of storageKeys) {
    try {
      storageDriver.deleteSync(storageKey);
    } catch (error) {
      logger?.error?.('account_trash_shared_file_delete_failed', { accountId, storageKey, error });
    }
  }
}

function deleteAccountRows(db, accountId, { deleteWorkspaceDocumentsForAccount } = {}) {
  const deleteByAccount = (table) => {
    if (!hasTable(db, table)) return;
    db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(accountId);
  };

  deleteByAccount('payments');
  deleteByAccount('sessions');
  deleteByAccount('reminders');
  deleteByAccount('staff_payments');
  deleteByAccount('files');
  if (hasTable(db, 'shared_files')) {
    db.prepare('DELETE FROM shared_files WHERE owner_account_id=?').run(accountId);
  }
  if (hasTable(db, 'task_history') && hasTable(db, 'tasks')) {
    db.prepare(`
      DELETE FROM task_history
      WHERE task_id IN (SELECT id FROM tasks WHERE account_id=?)
    `).run(accountId);
  }
  deleteByAccount('tasks');
  deleteByAccount('wallet_transactions');
  deleteByAccount('wallet_charge_requests');
  deleteByAccount('user_wallets');
  deleteByAccount('sync_events');
  deleteByAccount('push_subscriptions');

  if (hasTable(db, 'user_data_version_summaries')) {
    db.prepare('DELETE FROM user_data_version_summaries WHERE account_id=? OR account_id LIKE ?')
      .run(accountId, accountId + '::workspace::%');
  }
  if (hasTable(db, 'user_data_versions')) {
    db.prepare('DELETE FROM user_data_versions WHERE account_id=? OR account_id LIKE ?')
      .run(accountId, accountId + '::workspace::%');
  }

  if (typeof deleteWorkspaceDocumentsForAccount === 'function') {
    deleteWorkspaceDocumentsForAccount(db, accountId);
  }

  if (hasTable(db, 'account_workspaces')) {
    db.prepare('DELETE FROM account_workspaces WHERE owner_account_id=?').run(accountId);
  }

  deleteByAccount('clients');
  deleteByAccount('staff');

  if (hasTable(db, 'accounts')) {
    db.prepare('DELETE FROM accounts WHERE id=?').run(accountId);
  }
}

function hardDeleteAccount(db, accountId, deps) {
  const {
    deleteWorkspaceDocumentsForAccount,
    deleteStoredFiles,
    storageDriver,
    logger,
    skipPrePurgeBackup = false,
    backupDir,
    now = Date.now(),
  } = deps;
  if (!skipPrePurgeBackup) {
    ensurePrePurgeAccountBackup(db, accountId, { logger, backupDir, now });
  }
  const sharedStorageKeys = sharedStorageKeysForAccount(db, accountId);
  const run = db.transaction((id) => {
    deleteAccountRows(db, id, { deleteWorkspaceDocumentsForAccount });
    return true;
  });
  run(accountId);
  deleteCapturedSharedFiles(storageDriver, sharedStorageKeys, { accountId, logger });
  try {
    if (typeof deleteStoredFiles === 'function') {
      deleteStoredFiles(db, storageDriver, { ownerAccountId: accountId });
    }
  } catch (error) {
    logger?.error?.('account_trash_file_delete_failed', { accountId, error });
  }
  return true;
}

function purgeExpiredTrashedAccounts(db, deps, { now = Date.now(), logger = null, env = process.env } = {}) {
  ensureAccountTrashSchema(db);
  try {
    purgeOldPrePurgeAccountBackups({ now, logger, backupDir: deps?.backupDir });
  } catch (error) {
    logger?.error?.('purged_account_backup_retention_failed', { error });
  }
  const cutoff = sqlTime(now - ACCOUNT_TRASH_RETENTION_MS);
  const expired = db.prepare(`
    SELECT id, email, role FROM accounts
    WHERE deleted_at IS NOT NULL AND deleted_at <= ?
  `).all(cutoff);
  let purged = 0;
  for (const row of expired) {
    if (isProtectedAccount(db, row, env)) continue;
    if (String(row.role || '').toLowerCase() === 'admin') continue;
    try {
      hardDeleteAccount(db, row.id, deps);
      purged += 1;
      logger?.info?.('account_trash_purged', { accountId: row.id });
    } catch (error) {
      logger?.error?.('account_trash_purge_failed', { accountId: row.id, error });
    }
  }
  return purged;
}

module.exports = {
  ACCOUNT_TRASH_RETENTION_DAYS,
  ACCOUNT_TRASH_RETENTION_MS,
  PURGED_BACKUP_DIR,
  PURGED_BACKUP_RETENTION_DAYS,
  ACCOUNT_DEACTIVATED_MESSAGE,
  ensureAccountTrashSchema,
  ownerAccountIdFromStorageKey,
  isAccountTrashed,
  isAccountActive,
  trashAccount,
  restoreAccount,
  listTrashedAccounts,
  writePrePurgeAccountBackup,
  ensurePrePurgeAccountBackup,
  recentPrePurgeBackupPath,
  purgeOldPrePurgeAccountBackups,
  hardDeleteAccount,
  purgeExpiredTrashedAccounts,
  daysRemaining,
};