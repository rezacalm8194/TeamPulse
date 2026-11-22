const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const bcrypt = require('bcryptjs');
const {
  ACCOUNT_TRASH_RETENTION_DAYS,
  ACCOUNT_DEACTIVATED_MESSAGE,
  ensureAccountTrashSchema,
  trashAccount,
  restoreAccount,
  listTrashedAccounts,
  hardDeleteAccount,
  purgeExpiredTrashedAccounts,
  isAccountTrashed,
  writePrePurgeAccountBackup,
} = require('../utils/accountTrash');
const { ensureDocumentStoreSchema, writeWorkspaceDocument } = require('../utils/documentStore');
const { workspaceStorageKey } = require('../utils/teamAccessSchema');
const { hasAppDocumentPayload } = require('../utils/userBackup');
const {
  ensureTokenRevocationSchema,
  currentTokenVersion,
  bumpTokenVersion,
} = require('../utils/tokenRevocation');

process.env.JWT_SECRET = 'account-trash-unit-test-secret';
delete process.env.JWT_EXPIRES_IN;
const jwtPath = require.resolve('../utils/jwt');
delete require.cache[jwtPath];
const { sign, verify } = require('../utils/jwt');

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

function count(db, sql, ...args) {
  return Number(db.prepare(sql).get(...args).n);
}

function tableRowCounts(db) {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all().map(r => r.name);
  const out = {};
  for (const name of tables) {
    out[name] = count(db, `SELECT COUNT(*) AS n FROM ${name}`);
  }
  return out;
}

function setup() {
  const db = openDb();
  const passwordHash = bcrypt.hashSync('secret12', 4);
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, email TEXT, password TEXT, name TEXT, role TEXT DEFAULT 'owner',
      is_active INTEGER DEFAULT 1, token_version INTEGER DEFAULT 0, phone TEXT,
      business_name TEXT, business_type TEXT, plan TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
    );
    CREATE TABLE clients (id TEXT PRIMARY KEY, account_id TEXT, name TEXT);
    CREATE TABLE payments (id TEXT PRIMARY KEY, account_id TEXT, amount INTEGER);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE reminders (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE staff_payments (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE files (id TEXT PRIMARY KEY, account_id TEXT, owner TEXT, workspace TEXT, name TEXT);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE wallet_transactions (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE wallet_charge_requests (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE user_wallets (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE sync_events (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE user_data_version_summaries (account_id TEXT PRIMARY KEY);
    CREATE TABLE user_data_versions (account_id TEXT PRIMARY KEY, payload TEXT);
    CREATE TABLE account_workspaces (
      owner_account_id TEXT NOT NULL, workspace_id TEXT NOT NULL, name TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_account_id, workspace_id)
    );
    CREATE TABLE staff (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE docs (storage_key TEXT PRIMARY KEY, body TEXT);

    INSERT INTO accounts (id, email, password, name, role) VALUES
      ('victim', 'victim@example.test', '${passwordHash}', 'Victim', 'owner'),
      ('other', 'other@example.test', '${passwordHash}', 'Other', 'owner'),
      ('admin-prot', 'protected-admin@example.test', '${passwordHash}', 'Prot Admin', 'admin');

    INSERT INTO clients VALUES ('c1', 'victim', 'A'), ('c2', 'other', 'B');
    INSERT INTO payments VALUES ('p1', 'victim', 100), ('p2', 'other', 200);
    INSERT INTO files VALUES ('f1', 'victim', 'victim', 'default', 'a.jpg'), ('f2', 'other', 'other', 'default', 'b.jpg');
    INSERT INTO user_data_versions VALUES ('victim::workspace::default', '{}'), ('other::workspace::default', '{}');
    INSERT INTO docs VALUES ('victim::workspace::default', 'data'), ('other::workspace::default', 'keep');
    INSERT INTO account_workspaces (owner_account_id, workspace_id, name)
      VALUES ('victim', 'default', 'Main'), ('other', 'default', 'Main');
    INSERT INTO push_subscriptions VALUES ('ps1', 'victim');
  `);
  ensureAccountTrashSchema(db);
  ensureTokenRevocationSchema(db);
  ensureDocumentStoreSchema(db);
  writeWorkspaceDocument(db, workspaceStorageKey('victim', 'default'), {
    students: [{ id: 1, name: 'KeepMe' }],
  }, { replaceAll: true });

  let fileDeleteCalls = 0;
  const deps = {
    deleteWorkspaceDocumentsForAccount(d, accountId) {
      d.prepare('DELETE FROM docs WHERE storage_key LIKE ?').run(accountId + '::workspace::%');
    },
    deleteStoredFiles() {
      fileDeleteCalls += 1;
    },
    storageDriver: null,
    logger: null,
    get fileDeleteCalls() { return fileDeleteCalls; },
    resetFileDeletes() { fileDeleteCalls = 0; },
  };
  return { db, deps, passwordHash };
}

function permanentDeleteGate(target, confirmEmail) {
  if (!target) return { status: 404, error: 'not found' };
  if (!target.deleted_at) return { status: 400, error: 'account_not_in_trash' };
  const confirm = String(confirmEmail || '').trim().toLowerCase();
  const accountEmail = String(target.email || '').trim().toLowerCase();
  if (!confirm || confirm !== accountEmail) {
    return { status: 400, error: 'confirm_email_mismatch' };
  }
  return { ok: true };
}

async function tryLogin(db, email, password) {
  const normalized = String(email || '').trim().toLowerCase();
  const trashed = db.prepare(`
    SELECT id FROM accounts WHERE lower(trim(email))=? AND deleted_at IS NOT NULL LIMIT 1
  `).get(normalized);
  if (trashed) {
    return { status: 403, error: 'account_deactivated', message: ACCOUNT_DEACTIVATED_MESSAGE };
  }
  const candidates = db.prepare(`
    SELECT * FROM accounts
    WHERE lower(trim(email))=? AND is_active=1 AND deleted_at IS NULL
    ORDER BY datetime(created_at) ASC, rowid ASC
  `).all(normalized);
  for (const candidate of candidates) {
    if (await bcrypt.compare(password, candidate.password)) {
      return { status: 200, userId: candidate.id };
    }
  }
  return { status: 401, error: 'invalid credentials' };
}

function tokenPassesAuthGate(db, userId, token) {
  const payload = verify(token);
  const account = db.prepare('SELECT id, is_active, deleted_at FROM accounts WHERE id=?').get(userId);
  if (!account || Number(account.is_active) !== 1) return false;
  if (account.deleted_at) return false;
  if (currentTokenVersion(db, account.id) !== payload.tv) return false;
  return true;
}

test('trash sets deleted_at only — no rows or files removed', () => {
  const { db, deps } = setup();
  const before = tableRowCounts(db);
  assert.equal(trashAccount(db, 'victim', 'admin-1', { now: T0 }), true);
  const after = tableRowCounts(db);
  assert.deepEqual(after, before);
  assert.ok(isAccountTrashed(db, 'victim'));
  assert.equal(deps.fileDeleteCalls, 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM clients WHERE account_id=?', 'victim'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM files'), 2);
});

test('trashed account cannot login; prior token dies; restore re-enables login', async () => {
  const { db } = setup();
  const tokenBefore = sign({ id: 'victim', tv: currentTokenVersion(db, 'victim') });
  assert.equal(tokenPassesAuthGate(db, 'victim', tokenBefore), true);
  assert.equal((await tryLogin(db, 'victim@example.test', 'secret12')).status, 200);

  trashAccount(db, 'victim', 'admin-1', { now: T0 });
  bumpTokenVersion(db, 'victim');

  assert.equal(tokenPassesAuthGate(db, 'victim', tokenBefore), false);
  const loginTrashed = await tryLogin(db, 'victim@example.test', 'secret12');
  assert.equal(loginTrashed.status, 403);
  assert.equal(loginTrashed.error, 'account_deactivated');

  restoreAccount(db, 'victim');
  assert.equal((await tryLogin(db, 'victim@example.test', 'secret12')).status, 200);
  const tokenAfter = sign({ id: 'victim', tv: currentTokenVersion(db, 'victim') });
  assert.equal(tokenPassesAuthGate(db, 'victim', tokenAfter), true);
});

test('permanent delete requires confirm_email and account must be in trash', () => {
  const { db, deps } = setup();
  const active = db.prepare('SELECT id,email,deleted_at FROM accounts WHERE id=?').get('victim');
  assert.deepEqual(permanentDeleteGate(active, 'victim@example.test'), { status: 400, error: 'account_not_in_trash' });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM accounts WHERE id=?', 'victim'), 1);
  assert.equal(deps.fileDeleteCalls, 0);

  trashAccount(db, 'victim', 'admin-1', { now: T0 });
  const trashed = db.prepare('SELECT id,email,deleted_at FROM accounts WHERE id=?').get('victim');
  assert.deepEqual(permanentDeleteGate(trashed, ''), { status: 400, error: 'confirm_email_mismatch' });
  assert.deepEqual(permanentDeleteGate(trashed, 'wrong@test.com'), { status: 400, error: 'confirm_email_mismatch' });
  assert.deepEqual(permanentDeleteGate(trashed, 'victim@example.test'), { ok: true });
});

test('purge deletes only accounts past 30 days and never protected admins', () => {
  const { db, deps } = setup();
  const env = { PROTECTED_ADMIN_EMAILS: 'protected-admin@example.test' };
  trashAccount(db, 'victim', 'admin-1', { now: T0 });
  trashAccount(db, 'admin-prot', 'admin-1', { now: T0 - 31 * DAY });
  assert.equal(purgeExpiredTrashedAccounts(db, deps, { now: T0 + 29 * DAY, env }), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM accounts'), 3);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM accounts WHERE id='victim'"), 1,
    'victim still inside 30-day window on day 29');
  db.prepare(`UPDATE accounts SET deleted_at=? WHERE id=?`).run('2026-10-22 12:00:00', 'victim');
  assert.equal(purgeExpiredTrashedAccounts(db, deps, { now: T0, env }), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM accounts WHERE id='victim'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM accounts WHERE id='admin-prot'"), 1);
  assert.equal(ACCOUNT_TRASH_RETENTION_DAYS, 30);
});

test('hardDeleteAccount skips file deletes when the database transaction fails', () => {
  const { db } = setup();
  trashAccount(db, 'victim', 'admin-1', { now: T0 });
  let fileDeleteCalls = 0;
  const failingDeps = {
    deleteWorkspaceDocumentsForAccount() {
      throw new Error('simulated_db_failure');
    },
    deleteStoredFiles() { fileDeleteCalls += 1; },
    storageDriver: null,
    logger: null,
    skipPrePurgeBackup: true,
  };
  assert.throws(() => hardDeleteAccount(db, 'victim', failingDeps));
  assert.equal(fileDeleteCalls, 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM accounts WHERE id='victim'"), 1);
});

test('hard delete wipes victim data only', () => {
  const { db, deps } = setup();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-purge-backup-'));
  trashAccount(db, 'victim', 'admin-1', { now: T0 });
  hardDeleteAccount(db, 'victim', { ...deps, backupDir });
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM accounts WHERE id='victim'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM clients WHERE account_id='victim'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM files WHERE account_id='victim'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM docs WHERE storage_key LIKE 'victim%'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM accounts WHERE id='other'"), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM clients WHERE account_id='other'"), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM docs WHERE storage_key='other::workspace::default'"), 1);
  assert.equal(deps.fileDeleteCalls, 1);
  const backups = fs.readdirSync(backupDir).filter(name => name.endsWith('.json.gz'));
  assert.equal(backups.length, 1);
  const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(backupDir, backups[0]))).toString('utf8'));
  assert.ok(hasAppDocumentPayload(payload));
  assert.equal(payload.meta.account_id, 'victim');
  fs.rmSync(backupDir, { recursive: true, force: true });
});

test('hard delete is aborted when pre-purge backup cannot be written', () => {
  const { db, deps } = setup();
  trashAccount(db, 'victim', 'admin-1', { now: T0 });
  const blocker = path.join(os.tmpdir(), `tp-not-a-dir-${Date.now()}`);
  fs.writeFileSync(blocker, 'blocked');
  assert.throws(() => writePrePurgeAccountBackup(db, 'victim', { backupDir: blocker }), /ENOTDIR|EEXIST|ENOENT/);
  assert.throws(
    () => hardDeleteAccount(db, 'victim', { ...deps, backupDir: blocker }),
    /ENOTDIR|EEXIST|ENOENT/
  );
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM accounts WHERE id='victim'"), 1);
  fs.unlinkSync(blocker);
});

test('hard delete tolerates missing optional wallet tables', () => {
  const { db, deps } = setup();
  trashAccount(db, 'victim', 'admin-1', { now: T0 });
  db.exec('DROP TABLE wallet_transactions');
  db.exec('DROP TABLE wallet_charge_requests');
  db.exec('DROP TABLE user_wallets');
  hardDeleteAccount(db, 'victim', { ...deps, skipPrePurgeBackup: true });
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM accounts WHERE id='victim'"), 0);
});

test('purge never hard-deletes trashed admin accounts', () => {
  const { db, deps } = setup();
  db.prepare(`UPDATE accounts SET role='admin' WHERE id='victim'`).run();
  trashAccount(db, 'victim', 'admin-1', { now: T0 - 40 * DAY });
  assert.equal(purgeExpiredTrashedAccounts(db, { ...deps, skipPrePurgeBackup: true }, { now: T0, env: {} }), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM accounts WHERE id='victim'"), 1);
});

test('trash list reports retention metadata and counts', () => {
  const { db } = setup();
  trashAccount(db, 'victim', 'admin-1', { now: T0 });
  const list = listTrashedAccounts(db, { now: T0 });
  assert.equal(list.length, 1);
  assert.equal(list[0].email, 'victim@example.test');
  assert.equal(list[0].client_count, 1);
  assert.equal(list[0].workspace_count, 1);
  assert.equal(list[0].days_remaining, 30);
});