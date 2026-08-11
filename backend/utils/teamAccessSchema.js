function ensureTeamAccessSchema(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_access_grants'").get();
  if (!table) {
    db.prepare(`
      CREATE TABLE team_access_grants (
        owner_account_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT 'default',
        member_email TEXT NOT NULL,
        staff_id TEXT,
        invite_id TEXT,
        permissions TEXT DEFAULT '[]',
        instruction_folders TEXT DEFAULT '[]',
        status TEXT DEFAULT 'active',
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (owner_account_id, workspace_id, member_email)
      )
    `).run();
  } else {
    const columns = db.prepare('PRAGMA table_info(team_access_grants)').all();
    const hasWorkspace = columns.some(column => column.name === 'workspace_id');
    const primaryKey = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
    const workspaceScopedKey = primaryKey.join(',') === 'owner_account_id,workspace_id,member_email';
    if (!hasWorkspace || !workspaceScopedKey) {
      db.transaction(() => {
        db.prepare('DROP TABLE IF EXISTS team_access_grants_legacy_workspace').run();
        db.prepare('ALTER TABLE team_access_grants RENAME TO team_access_grants_legacy_workspace').run();
        db.prepare(`
          CREATE TABLE team_access_grants (
            owner_account_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL DEFAULT 'default',
            member_email TEXT NOT NULL,
            staff_id TEXT,
            invite_id TEXT,
            permissions TEXT DEFAULT '[]',
            instruction_folders TEXT DEFAULT '[]',
            status TEXT DEFAULT 'active',
            updated_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (owner_account_id, workspace_id, member_email)
          )
        `).run();
        const legacyColumns = db.prepare('PRAGMA table_info(team_access_grants_legacy_workspace)').all().map(column => column.name);
        const select = name => legacyColumns.includes(name) ? name : 'NULL';
        db.prepare(`
          INSERT INTO team_access_grants
            (owner_account_id, workspace_id, member_email, staff_id, invite_id, permissions, instruction_folders, status, updated_at)
          SELECT owner_account_id, 'default', member_email,
            ${select('staff_id')}, ${select('invite_id')},
            COALESCE(${select('permissions')}, '[]'),
            COALESCE(${select('instruction_folders')}, '[]'),
            COALESCE(${select('status')}, 'active'),
            COALESCE(${select('updated_at')}, datetime('now'))
          FROM team_access_grants_legacy_workspace
        `).run();
        db.prepare('DROP TABLE team_access_grants_legacy_workspace').run();
      })();
    }
  }
  db.prepare('CREATE INDEX IF NOT EXISTS idx_team_access_member_workspace ON team_access_grants(member_email, owner_account_id, workspace_id, status)').run();
}

function normalizeWorkspaceId(value) {
  const workspaceId = String(value || 'default').trim();
  if (!workspaceId || workspaceId === 'default') return 'default';
  return /^acc_[a-zA-Z0-9_-]{6,80}$/.test(workspaceId) ? workspaceId : null;
}

function workspaceStorageKey(ownerAccountId, workspaceId) {
  return workspaceId === 'default'
    ? ownerAccountId
    : `${ownerAccountId}::workspace::${workspaceId}`;
}

module.exports = { ensureTeamAccessSchema, normalizeWorkspaceId, workspaceStorageKey };
