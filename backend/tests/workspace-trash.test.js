const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TRASH_RETENTION_DAYS,
  SUSPENDED_GRANT_STATUS,
  isWorkspaceActive,
  trashWorkspace,
  restoreWorkspace,
  listTrashedWorkspaces,
  purgeExpiredTrashedWorkspaces,
  normalizeWorkspaceName,
  activeWorkspaceNameTaken,
  workspaceCustomerCounts,
} = require('../utils/workspaceTrash');

// Uses better-sqlite3 like the rest of the suite; falls back to Node's
// built-in SQLite (with a tiny transaction shim) where the native module
// is not installed.
function openDb() {
  try {
    const Database = require('better-sqlite3');
    return new Database(':memory:');
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.transaction = fn => (...args) => {
      db.exec('BEGIN');
      try { const result = fn(...args); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    };
    return db;
  }
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);

function setup() {
  const db = openDb();
  db.exec(`
    CREATE TABLE account_workspaces (
      owner_account_id TEXT NOT NULL, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_account_id, workspace_id)
    );
    CREATE TABLE team_access_grants (
      owner_account_id TEXT, workspace_id TEXT, member_email TEXT, status TEXT DEFAULT 'active',
      updated_at TEXT, PRIMARY KEY (owner_account_id, workspace_id, member_email)
    );
    CREATE TABLE push_subscriptions (id TEXT, account_id TEXT, workspace_id TEXT);
    CREATE TABLE user_data_versions (account_id TEXT, payload TEXT);
    CREATE TABLE docs (storage_key TEXT, body TEXT);
    CREATE TABLE files (owner TEXT, workspace TEXT, name TEXT);
    INSERT INTO account_workspaces(owner_account_id, workspace_id, name) VALUES
      ('u1', 'acc_shop01', 'فروشگاه'), ('u1', 'acc_gym001', 'باشگاه'), ('u2', 'acc_other1', 'دیگری');
    INSERT INTO team_access_grants VALUES ('u1', 'acc_shop01', 'staff@x.ir', 'active', NULL);
    INSERT INTO push_subscriptions VALUES ('p1', 'u1', 'acc_shop01');
    INSERT INTO user_data_versions VALUES ('u1::workspace::acc_shop01', 'v1');
    INSERT INTO docs VALUES ('u1::workspace::acc_shop01', 'customers + payments');
    INSERT INTO files VALUES ('u1', 'acc_shop01', 'receipt.jpg');
  `);
  const deps = {
    workspaceStorageKey: (owner, ws) => `${owner}::workspace::${ws}`,
    deleteWorkspaceDocument: (d, key) => d.prepare('DELETE FROM docs WHERE storage_key=?').run(key),
    deleteStoredFiles: (d, _driver, { ownerAccountId, workspaceId }) =>
      d.prepare('DELETE FROM files WHERE owner=? AND workspace=?').run(ownerAccountId, workspaceId),
    storageDriver: null,
  };
  return { db, deps };
}

const count = (db, sql, ...args) => db.prepare(sql).get(...args).n;

test('trashing keeps every piece of data but hides the workspace', () => {
  const { db } = setup();
  assert.equal(trashWorkspace(db, 'u1', 'acc_shop01', { now: T0 }), true);
  assert.equal(isWorkspaceActive(db, 'u1', 'acc_shop01'), false);
  assert.equal(isWorkspaceActive(db, 'u1', 'acc_gym001'), true, 'other workspaces untouched');
  assert.equal(isWorkspaceActive(db, 'u1', 'default'), true);
  assert.equal(count(db, "SELECT COUNT(*) n FROM docs WHERE storage_key='u1::workspace::acc_shop01'"), 1);
  assert.equal(count(db, "SELECT COUNT(*) n FROM user_data_versions"), 1);
  assert.equal(count(db, "SELECT COUNT(*) n FROM files"), 1);
  assert.equal(db.prepare('SELECT status FROM team_access_grants').get().status, SUSPENDED_GRANT_STATUS);
  assert.equal(trashWorkspace(db, 'u1', 'acc_shop01', { now: T0 }), false, 'second delete is a no-op');
  assert.equal(trashWorkspace(db, 'u1', 'acc_other1'), false, 'cannot trash another owner\'s workspace id');
});

test('trash list reports purge date 30 days later', () => {
  const { db } = setup();
  trashWorkspace(db, 'u1', 'acc_shop01', { now: T0 });
  const trash = listTrashedWorkspaces(db, 'u1');
  assert.equal(trash.length, 1);
  assert.equal(trash[0].id, 'acc_shop01');
  assert.equal(trash[0].name, 'فروشگاه');
  assert.equal(trash[0].deleted_at, '2026-11-22 12:00:00');
  assert.equal(trash[0].purge_at, '2026-12-22 12:00:00');
  assert.equal(TRASH_RETENTION_DAYS, 30);
  assert.deepEqual(listTrashedWorkspaces(db, 'u2'), []);
});

test('restore brings the workspace and team access back', () => {
  const { db } = setup();
  trashWorkspace(db, 'u1', 'acc_shop01', { now: T0 });
  assert.deepEqual(restoreWorkspace(db, 'u1', 'acc_shop01', { maxSecondary: 4 }), { ok: true });
  assert.equal(isWorkspaceActive(db, 'u1', 'acc_shop01'), true);
  assert.equal(db.prepare('SELECT status FROM team_access_grants').get().status, 'active');
  assert.deepEqual(listTrashedWorkspaces(db, 'u1'), []);
  assert.equal(restoreWorkspace(db, 'u1', 'acc_shop01').error, 'workspace_not_in_trash');
});

test('restore respects the workspace limit', () => {
  const { db } = setup();
  trashWorkspace(db, 'u1', 'acc_shop01', { now: T0 });
  // u1 still has acc_gym001 active; a limit of 1 secondary blocks the restore.
  assert.equal(restoreWorkspace(db, 'u1', 'acc_shop01', { maxSecondary: 1 }).error, 'workspace_limit');
  assert.equal(isWorkspaceActive(db, 'u1', 'acc_shop01'), false);
});

test('purge only removes workspaces older than 30 days, and removes them fully', () => {
  const { db, deps } = setup();
  trashWorkspace(db, 'u1', 'acc_shop01', { now: T0 });
  assert.equal(purgeExpiredTrashedWorkspaces(db, deps, { now: T0 + 29 * DAY }), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM docs'), 1, 'still restorable on day 29');
  assert.equal(purgeExpiredTrashedWorkspaces(db, deps, { now: T0 + 30 * DAY + 1000 }), 1);
  assert.equal(count(db, "SELECT COUNT(*) n FROM account_workspaces WHERE workspace_id='acc_shop01'"), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM docs'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM files'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM user_data_versions'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM team_access_grants'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM account_workspaces'), 2, 'active workspaces never purged');
});

test('a restored workspace is never purged', () => {
  const { db, deps } = setup();
  trashWorkspace(db, 'u1', 'acc_shop01', { now: T0 });
  restoreWorkspace(db, 'u1', 'acc_shop01');
  assert.equal(purgeExpiredTrashedWorkspaces(db, deps, { now: T0 + 90 * DAY }), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM docs'), 1);
});

test('workspace names compare loosely (Arabic ye/kaf, spaces, ZWNJ)', () => {
  assert.equal(normalizeWorkspaceName('  هيدرو  ماهر '), normalizeWorkspaceName('هیدرو ماهر'));
  assert.equal(normalizeWorkspaceName('كوچينگ'), normalizeWorkspaceName('کوچینگ'));
  assert.equal(normalizeWorkspaceName('می\u200cخواهم'), normalizeWorkspaceName('میخواهم'));
  assert.equal(normalizeWorkspaceName('Shop'), normalizeWorkspaceName('shop'));
});

test('duplicate names are detected among active workspaces only', () => {
  const { db } = setup();
  assert.equal(activeWorkspaceNameTaken(db, 'u1', 'فروشگاه'), true);
  assert.equal(activeWorkspaceNameTaken(db, 'u1', ' فروشگاه '), true);
  assert.equal(activeWorkspaceNameTaken(db, 'u1', 'فروشگاه', { exceptWorkspaceId: 'acc_shop01' }), false, 'renaming to own name is fine');
  assert.equal(activeWorkspaceNameTaken(db, 'u2', 'فروشگاه'), false, 'other owners do not count');
  trashWorkspace(db, 'u1', 'acc_shop01', { now: T0 });
  assert.equal(activeWorkspaceNameTaken(db, 'u1', 'فروشگاه'), false, 'trashed names are free');
});

test('restoring next to a same-named active workspace gets a numbered name', () => {
  const { db } = setup();
  trashWorkspace(db, 'u1', 'acc_shop01', { now: T0 });
  db.prepare("INSERT INTO account_workspaces(owner_account_id, workspace_id, name) VALUES ('u1','acc_shop02','فروشگاه')").run();
  assert.deepEqual(restoreWorkspace(db, 'u1', 'acc_shop01'), { ok: true });
  assert.equal(db.prepare("SELECT name FROM account_workspaces WHERE workspace_id='acc_shop01'").get().name, 'فروشگاه (2)');
});

test('customer counts exclude archived customers and tolerate missing data', () => {
  const { db } = setup();
  assert.equal(workspaceCustomerCounts(db, ['u1']).size, 0, 'no table → empty');
  db.exec(`CREATE TABLE workspace_business_state (storage_key TEXT, collection_key TEXT, data_hash TEXT,
    row_count INTEGER, archived_count INTEGER, updated_at TEXT);
    INSERT INTO workspace_business_state VALUES ('u1','students','h',12,2,NULL), ('u1','payments','h',99,0,NULL);`);
  const counts = workspaceCustomerCounts(db, ['u1', 'u1::workspace::acc_gym001']);
  assert.equal(counts.get('u1'), 10);
  assert.equal(counts.has('u1::workspace::acc_gym001'), false);
});
