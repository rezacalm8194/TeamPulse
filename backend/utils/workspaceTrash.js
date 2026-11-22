'use strict';

// Workspace recycle bin.
//
// Deleting a workspace used to wipe its document, every version snapshot and
// every uploaded file immediately, behind a single browser confirm(). One
// mistaken tap destroyed a whole business's records with no way back.
//
// Now a delete only marks the workspace (deleted_at). Its data, snapshots and
// files stay untouched and the owner can restore it for TRASH_RETENTION_DAYS.
// While trashed, the workspace is hidden from lists, rejected by data routes
// (workspaceExists) and team grants are suspended. A periodic purge performs
// the old hard delete once the retention window has passed.

const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const SUSPENDED_GRANT_STATUS = 'workspace_trashed';

const schemaReady = new WeakSet();

function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function ensureWorkspaceTrashSchema(db) {
  if (schemaReady.has(db)) return;
  const columns = db.prepare('PRAGMA table_info(account_workspaces)').all();
  if (!columns.length) return; // table not created yet; caller creates it first
  if (!columns.some(column => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE account_workspaces ADD COLUMN deleted_at TEXT');
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_account_workspaces_deleted
    ON account_workspaces(deleted_at) WHERE deleted_at IS NOT NULL`);
  schemaReady.add(db);
}

function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function isWorkspaceActive(db, ownerAccountId, workspaceId) {
  if (workspaceId === 'default') return true;
  ensureWorkspaceTrashSchema(db);
  return !!db.prepare(`
    SELECT 1 FROM account_workspaces
    WHERE owner_account_id=? AND workspace_id=? AND deleted_at IS NULL
  `).get(ownerAccountId, workspaceId);
}

function countActiveWorkspaces(db, ownerAccountId) {
  ensureWorkspaceTrashSchema(db);
  return db.prepare(`
    SELECT COUNT(*) AS n FROM account_workspaces
    WHERE owner_account_id=? AND deleted_at IS NULL
  `).get(ownerAccountId).n;
}

function isWorkspaceTrashed(db, ownerAccountId, workspaceId) {
  ensureWorkspaceTrashSchema(db);
  return !!db.prepare(`
    SELECT 1 FROM account_workspaces
    WHERE owner_account_id=? AND workspace_id=? AND deleted_at IS NOT NULL
  `).get(ownerAccountId, workspaceId);
}

function trashWorkspace(db, ownerAccountId, workspaceId, { now = Date.now() } = {}) {
  ensureWorkspaceTrashSchema(db);
  const run = db.transaction(() => {
    const result = db.prepare(`
      UPDATE account_workspaces SET deleted_at=?, updated_at=?
      WHERE owner_account_id=? AND workspace_id=? AND deleted_at IS NULL
    `).run(sqlTime(now), sqlTime(now), ownerAccountId, workspaceId);
    if (!result.changes) return false;
    if (hasTable(db, 'team_access_grants')) {
      db.prepare(`
        UPDATE team_access_grants SET status=?, updated_at=datetime('now')
        WHERE owner_account_id=? AND workspace_id=? AND status='active'
      `).run(SUSPENDED_GRANT_STATUS, ownerAccountId, workspaceId);
    }
    // Push subscriptions are device registrations, not user data; devices
    // re-subscribe when the workspace is opened again after a restore.
    if (hasTable(db, 'push_subscriptions')) {
      try {
        db.prepare("DELETE FROM push_subscriptions WHERE account_id=? AND COALESCE(workspace_id,'default')=?")
          .run(ownerAccountId, workspaceId);
      } catch (_) {}
    }
    return true;
  });
  return run();
}

function restoreWorkspace(db, ownerAccountId, workspaceId, { maxSecondary = Infinity, now = Date.now() } = {}) {
  ensureWorkspaceTrashSchema(db);
  const run = db.transaction(() => {
    if (!isWorkspaceTrashed(db, ownerAccountId, workspaceId)) return { ok: false, error: 'workspace_not_in_trash' };
    if (countActiveWorkspaces(db, ownerAccountId) >= maxSecondary) return { ok: false, error: 'workspace_limit' };
    db.prepare(`
      UPDATE account_workspaces SET deleted_at=NULL, updated_at=?
      WHERE owner_account_id=? AND workspace_id=?
    `).run(sqlTime(now), ownerAccountId, workspaceId);
    if (hasTable(db, 'team_access_grants')) {
      db.prepare(`
        UPDATE team_access_grants SET status='active', updated_at=datetime('now')
        WHERE owner_account_id=? AND workspace_id=? AND status=?
      `).run(ownerAccountId, workspaceId, SUSPENDED_GRANT_STATUS);
    }
    return { ok: true };
  });
  return run();
}

function listTrashedWorkspaces(db, ownerAccountId) {
  ensureWorkspaceTrashSchema(db);
  return db.prepare(`
    SELECT workspace_id AS id, name, deleted_at FROM account_workspaces
    WHERE owner_account_id=? AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `).all(ownerAccountId).map(row => {
    const deletedMs = Date.parse(String(row.deleted_at).replace(' ', 'T') + 'Z');
    return {
      id: row.id,
      name: row.name,
      deleted_at: row.deleted_at,
      purge_at: Number.isFinite(deletedMs) ? sqlTime(deletedMs + TRASH_RETENTION_MS) : null,
    };
  });
}

// The previous immediate-delete behaviour, now only reached by the purge.
function hardDeleteWorkspace(db, ownerAccountId, workspaceId, deps) {
  const { storageKey, deleteWorkspaceDocument, deleteStoredFiles, storageDriver } = deps;
  const run = db.transaction(() => {
    const result = db.prepare('DELETE FROM account_workspaces WHERE owner_account_id=? AND workspace_id=?')
      .run(ownerAccountId, workspaceId);
    if (!result.changes) return false;
    if (hasTable(db, 'team_access_grants')) {
      db.prepare('DELETE FROM team_access_grants WHERE owner_account_id=? AND workspace_id=?').run(ownerAccountId, workspaceId);
    }
    if (hasTable(db, 'push_subscriptions')) {
      try {
        db.prepare("DELETE FROM push_subscriptions WHERE account_id=? AND COALESCE(workspace_id,'default')=?")
          .run(ownerAccountId, workspaceId);
      } catch (_) {}
    }
    if (hasTable(db, 'user_data_version_summaries')) {
      db.prepare('DELETE FROM user_data_version_summaries WHERE account_id=?').run(storageKey);
    }
    if (hasTable(db, 'user_data_versions')) {
      db.prepare('DELETE FROM user_data_versions WHERE account_id=?').run(storageKey);
    }
    deleteWorkspaceDocument(db, storageKey);
    deleteStoredFiles(db, storageDriver, { ownerAccountId, workspaceId });
    return true;
  });
  return run();
}

function purgeExpiredTrashedWorkspaces(db, deps, { now = Date.now(), logger = null } = {}) {
  ensureWorkspaceTrashSchema(db);
  const cutoff = sqlTime(now - TRASH_RETENTION_MS);
  const expired = db.prepare(`
    SELECT owner_account_id, workspace_id FROM account_workspaces
    WHERE deleted_at IS NOT NULL AND deleted_at <= ?
  `).all(cutoff);
  let purged = 0;
  for (const row of expired) {
    try {
      const ok = hardDeleteWorkspace(db, row.owner_account_id, row.workspace_id, {
        ...deps,
        storageKey: deps.workspaceStorageKey(row.owner_account_id, row.workspace_id),
      });
      if (ok) {
        purged += 1;
        logger?.info?.('workspace_trash_purged', { owner: row.owner_account_id, workspace: row.workspace_id });
      }
    } catch (error) {
      logger?.error?.('workspace_trash_purge_failed', { owner: row.owner_account_id, workspace: row.workspace_id, error });
    }
  }
  return purged;
}

module.exports = {
  TRASH_RETENTION_DAYS,
  SUSPENDED_GRANT_STATUS,
  ensureWorkspaceTrashSchema,
  isWorkspaceActive,
  isWorkspaceTrashed,
  countActiveWorkspaces,
  trashWorkspace,
  restoreWorkspace,
  listTrashedWorkspaces,
  hardDeleteWorkspace,
  purgeExpiredTrashedWorkspaces,
};
