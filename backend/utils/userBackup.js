const {
  ensureDocumentStoreSchema,
  loadWorkspaceDocument,
  serializeWorkspaceDocument,
  writeWorkspaceDocument,
} = require('./documentStore');
const { normalizeWorkspaceId, workspaceStorageKey } = require('./teamAccessSchema');
const { ensureVersionSnapshotSchema, saveVersionSnapshot } = require('./versionSnapshots');

const DATA_ARRAY_KEYS = [
  'students',
  'packages',
  'payments',
  'sessions',
  'expenses',
  'families',
  'todos',
  'staff',
  'instructions',
  'team_members',
  'goals',
  'habits',
];

const LEGACY_RELATIONAL_TABLES = [
  'clients',
  'staff',
  'payments',
  'staff_payments',
  'sessions',
  'tasks',
  'reminders',
];

function ensureWorkspaceRegistry(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_workspaces (
      owner_account_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_account_id, workspace_id)
    );
    CREATE INDEX IF NOT EXISTS idx_account_workspaces_owner
      ON account_workspaces(owner_account_id, created_at);
  `);
}

function itemCounts(data) {
  const counts = {};
  DATA_ARRAY_KEYS.forEach(key => {
    counts[key] = Array.isArray(data?.[key]) ? data[key].length : 0;
  });
  return counts;
}

function cleanImportedAppData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const clean = { ...data };
  delete clean._gdrive_token;
  delete clean._gdrive_token_expiry;
  delete clean._gcal_token;
  delete clean._gcal_token_expiry;
  return clean;
}

function loadWorkspacePayload(db, storageKey) {
  const loaded = loadWorkspaceDocument(db, storageKey);
  if (!loaded || loaded.data == null) {
    return { data: null, updated_at: loaded?.updated_at || null, item_counts: itemCounts(null) };
  }
  return {
    data: loaded.data,
    updated_at: loaded.updated_at || null,
    item_counts: itemCounts(loaded.data),
  };
}

function listExtraWorkspaces(db, accountId) {
  ensureWorkspaceRegistry(db);
  const named = db.prepare(
    'SELECT workspace_id AS id, name FROM account_workspaces WHERE owner_account_id=? ORDER BY created_at, workspace_id'
  ).all(accountId);
  const byId = new Map(named.map(row => [row.id, row]));
  const prefix = `${accountId}::workspace::`;
  db.prepare(
    "SELECT account_id FROM user_data WHERE account_id LIKE ? AND account_id <> ?"
  ).all(`${prefix}%`, accountId).forEach(row => {
    const workspaceId = String(row.account_id).slice(prefix.length);
    if (!workspaceId || byId.has(workspaceId)) return;
    byId.set(workspaceId, { id: workspaceId, name: workspaceId });
  });
  return [...byId.values()];
}

function collectLegacyRelationalRows(db, accountId) {
  const existingTables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
  );
  const legacy = {};
  LEGACY_RELATIONAL_TABLES.forEach(table => {
    if (!existingTables.has(table)) return;
    const rows = db.prepare(`SELECT * FROM ${table} WHERE account_id=?`).all(accountId);
    if (!rows.length) return;
    legacy[table] = table === 'staff'
      ? rows.map(({ password, ...safeStaff }) => safeStaff)
      : rows;
  });
  return legacy;
}

function collectAccountAppBackup(db, account, exportedAt = new Date().toISOString()) {
  ensureDocumentStoreSchema(db);
  const accountId = account.id;
  const defaultPayload = loadWorkspacePayload(db, workspaceStorageKey(accountId, 'default'));
  const extras = listExtraWorkspaces(db, accountId)
    .map(row => {
      const workspaceId = normalizeWorkspaceId(row.id);
      if (!workspaceId || workspaceId === 'default') return null;
      const payload = loadWorkspacePayload(db, workspaceStorageKey(accountId, workspaceId));
      return {
        id: workspaceId,
        name: row.name || workspaceId,
        updated_at: payload.updated_at,
        item_counts: payload.item_counts,
        data: payload.data,
      };
    })
    .filter(Boolean);

  const workspaces = [
    {
      id: 'default',
      name: 'میزکار اصلی',
      updated_at: defaultPayload.updated_at,
      item_counts: defaultPayload.item_counts,
      data: defaultPayload.data,
    },
    ...extras,
  ];

  const totals = itemCounts(null);
  workspaces.forEach(workspace => {
    DATA_ARRAY_KEYS.forEach(key => {
      totals[key] += workspace.item_counts[key] || 0;
    });
  });

  const legacy_tables = collectLegacyRelationalRows(db, accountId);
  return {
    meta: {
      product: 'TeamPulse',
      type: 'user-app-backup',
      version: '2.0.0',
      source: 'user_data',
      exported_at: exportedAt,
      account_id: accountId,
      item_counts: totals,
    },
    account: {
      id: account.id,
      name: account.name,
      email: account.email,
      business_name: account.business_name,
      business_type: account.business_type,
      plan: account.plan,
      created_at: account.created_at,
    },
    app_data: defaultPayload.data,
    workspaces,
    ...(Object.keys(legacy_tables).length ? { legacy_tables } : {}),
  };
}

function hasAppDocumentPayload(backup) {
  if (backup?.app_data && typeof backup.app_data === 'object' && !Array.isArray(backup.app_data)) {
    return true;
  }
  return Array.isArray(backup?.workspaces)
    && backup.workspaces.some(workspace => workspace && typeof workspace.data === 'object' && workspace.data !== null);
}

function restoreAccountAppBackup(db, accountId, backup) {
  ensureDocumentStoreSchema(db);
  ensureVersionSnapshotSchema(db);
  ensureWorkspaceRegistry(db);

  const documents = [];
  if (Array.isArray(backup.workspaces) && backup.workspaces.length) {
    backup.workspaces.forEach(workspace => {
      const workspaceId = workspace?.id === 'default'
        ? 'default'
        : normalizeWorkspaceId(workspace?.id);
      if (!workspaceId) return;
      const data = cleanImportedAppData(workspace.data);
      if (!data) return;
      documents.push({
        workspaceId,
        name: String(workspace.name || '').trim().slice(0, 80),
        data,
      });
    });
  }
  if (!documents.length) {
    const data = cleanImportedAppData(backup.app_data);
    if (data) documents.push({ workspaceId: 'default', name: 'میزکار اصلی', data });
  }
  if (!documents.length) return { restored_workspaces: 0 };

  documents.forEach(doc => {
    const storageKey = workspaceStorageKey(accountId, doc.workspaceId);
    const existing = loadWorkspaceDocument(db, storageKey);
    if (existing) {
      saveVersionSnapshot(db, storageKey, serializeWorkspaceDocument(db, storageKey), { force: true });
    }
    writeWorkspaceDocument(db, storageKey, doc.data, { replaceAll: true });
    if (doc.workspaceId === 'default') return;
    const name = doc.name || doc.workspaceId;
    const row = db.prepare(
      'SELECT 1 FROM account_workspaces WHERE owner_account_id=? AND workspace_id=?'
    ).get(accountId, doc.workspaceId);
    if (row) {
      db.prepare(
        `UPDATE account_workspaces SET name=?, updated_at=datetime('now') WHERE owner_account_id=? AND workspace_id=?`
      ).run(name, accountId, doc.workspaceId);
    } else {
      db.prepare(
        'INSERT INTO account_workspaces(owner_account_id,workspace_id,name) VALUES (?,?,?)'
      ).run(accountId, doc.workspaceId, name);
    }
  });

  return { restored_workspaces: documents.length };
}

module.exports = {
  DATA_ARRAY_KEYS,
  cleanImportedAppData,
  collectAccountAppBackup,
  hasAppDocumentPayload,
  restoreAccountAppBackup,
};
