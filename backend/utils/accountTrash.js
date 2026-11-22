'use strict';

// Account recycle bin (parallel to workspaceTrash).
//
// Admin delete used to wipe every row and file immediately. Now it only sets
// accounts.deleted_at for ACCOUNT_TRASH_RETENTION_DAYS; purge runs the old
// hard delete after the window. Data and files stay until then.

const { isProtectedAccount } = require('./protectedAdmin');

const ACCOUNT_TRASH_RETENTION_DAYS = 30;
const ACCOUNT_TRASH_RETENTION_MS = ACCOUNT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const schemaReady = new WeakSet();

const ACCOUNT_DEACTIVATED_MESSAGE = 'این حساب غیرفعال شده است؛ با پشتیبانی تماس بگیرید';

function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
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

function hardDeleteAccount(db, accountId, deps) {
  const { deleteWorkspaceDocumentsForAccount, deleteStoredFiles, storageDriver, logger } = deps;
  const run = db.transaction((id) => {
    db.prepare('DELETE FROM payments WHERE account_id=?').run(id);
    db.prepare('DELETE FROM sessions WHERE account_id=?').run(id);
    db.prepare('DELETE FROM reminders WHERE account_id=?').run(id);
    db.prepare('DELETE FROM staff_payments WHERE account_id=?').run(id);

    db.prepare('DELETE FROM files WHERE account_id=?').run(id);
    db.prepare('DELETE FROM tasks WHERE account_id=?').run(id);
    db.prepare('DELETE FROM wallet_transactions WHERE account_id=?').run(id);
    db.prepare('DELETE FROM wallet_charge_requests WHERE account_id=?').run(id);
    db.prepare('DELETE FROM user_wallets WHERE account_id=?').run(id);
    db.prepare('DELETE FROM sync_events WHERE account_id=?').run(id);
    db.prepare('DELETE FROM push_subscriptions WHERE account_id=?').run(id);
    db.prepare('DELETE FROM user_data_version_summaries WHERE account_id=? OR account_id LIKE ?')
      .run(id, id + '::workspace::%');
    db.prepare('DELETE FROM user_data_versions WHERE account_id=? OR account_id LIKE ?')
      .run(id, id + '::workspace::%');
    deleteWorkspaceDocumentsForAccount(db, id);
    db.prepare('DELETE FROM account_workspaces WHERE owner_account_id=?').run(id);

    db.prepare('DELETE FROM clients WHERE account_id=?').run(id);
    db.prepare('DELETE FROM staff WHERE account_id=?').run(id);
    db.prepare('DELETE FROM accounts WHERE id=?').run(id);
    return true;
  });
  run(accountId);
  try {
    deleteStoredFiles(db, storageDriver, { ownerAccountId: accountId });
  } catch (error) {
    logger?.error?.('account_trash_file_delete_failed', { accountId, error });
  }
  return true;
}

function purgeExpiredTrashedAccounts(db, deps, { now = Date.now(), logger = null, env = process.env } = {}) {
  ensureAccountTrashSchema(db);
  const cutoff = sqlTime(now - ACCOUNT_TRASH_RETENTION_MS);
  const expired = db.prepare(`
    SELECT id, email, role FROM accounts
    WHERE deleted_at IS NOT NULL AND deleted_at <= ?
  `).all(cutoff);
  let purged = 0;
  for (const row of expired) {
    if (isProtectedAccount(db, row, env)) continue;
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
  ACCOUNT_DEACTIVATED_MESSAGE,
  ensureAccountTrashSchema,
  ownerAccountIdFromStorageKey,
  isAccountTrashed,
  isAccountActive,
  trashAccount,
  restoreAccount,
  listTrashedAccounts,
  hardDeleteAccount,
  purgeExpiredTrashedAccounts,
  daysRemaining,
};