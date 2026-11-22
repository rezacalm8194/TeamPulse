const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const bcrypt = require('bcryptjs');
const {
  ensureAccountTrashSchema,
  trashAccount,
  hardDeleteAccount,
  ensurePrePurgeAccountBackup,
} = require('../utils/accountTrash');
const {
  ensureDocumentStoreSchema,
  deleteWorkspaceDocumentsForAccount,
  writeWorkspaceDocument,
} = require('../utils/documentStore');
const { ensureVersionSnapshotSchema } = require('../utils/versionSnapshots');
const { workspaceStorageKey } = require('../utils/teamAccessSchema');

const schemaSql = fs.readFileSync(
  path.join(__dirname, '..', 'database', 'schema.sql'),
  'utf8'
);

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

function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function count(db, sql, ...args) {
  return Number(db.prepare(sql).get(...args).n);
}

function victimRowCount(db, accountId) {
  let total = 0;
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all().map(row => row.name);
  for (const table of tables) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some(col => col.name === 'account_id')
      && !info.some(col => col.name === 'owner_account_id')
      && table !== 'user_data'
      && table !== 'user_data_parts'
      && table !== 'user_data_versions'
      && table !== 'user_data_version_summaries'
      && table !== 'task_history') continue;
    if (table === 'user_data' || table === 'user_data_parts') {
      total += count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE account_id=? OR account_id LIKE ?`, accountId, `${accountId}%`);
    } else if (table === 'user_data_versions' || table === 'user_data_version_summaries') {
      total += count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE account_id=? OR account_id LIKE ?`, accountId, `${accountId}%`);
    } else if (table === 'shared_files') {
      total += count(db, `SELECT COUNT(*) AS n FROM shared_files WHERE owner_account_id=?`, accountId);
    } else if (table === 'account_workspaces') {
      total += count(db, `SELECT COUNT(*) AS n FROM account_workspaces WHERE owner_account_id=?`, accountId);
    } else if (table === 'task_history') {
      total += count(db, `
        SELECT COUNT(*) AS n FROM task_history
        WHERE task_id IN (SELECT id FROM tasks WHERE account_id=?)
      `, accountId);
    } else if (table === 'accounts') {
      total += count(db, `SELECT COUNT(*) AS n FROM accounts WHERE id=?`, accountId);
    } else if (info.some(col => col.name === 'account_id')) {
      total += count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE account_id=?`, accountId);
    }
  }
  return total;
}

function buildRealDb() {
  const db = openDb();
  db.exec(schemaSql);
  db.pragma('foreign_keys = ON');
  ensureDocumentStoreSchema(db);
  ensureVersionSnapshotSchema(db);
  ensureAccountTrashSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_workspaces (
      owner_account_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_account_id, workspace_id)
    );
    CREATE TABLE IF NOT EXISTS shared_files (
      id TEXT PRIMARY KEY,
      owner_account_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT,
      sha256 TEXT
    );
  `);
  return db;
}

const VICTIM = 'acct-victim-real';
const OTHER = 'acct-other-real';
const pass = bcrypt.hashSync('SchemaTest123!', 4);

function seedPair(db) {
  const insAcct = db.prepare(`
    INSERT INTO accounts (id, name, email, password, role) VALUES (?,?,?,?,?)
  `);
  insAcct.run(VICTIM, 'Victim', 'victim-real@example.test', pass, 'owner');
  insAcct.run(OTHER, 'Other', 'other-real@example.test', pass, 'owner');

  const seedAccount = (accountId, label) => {
    const staffId = `${accountId}-staff`;
    const clientId = `${accountId}-client`;
    const taskId = `${accountId}-task`;
    db.prepare(`
      INSERT INTO staff (id, account_id, name, email) VALUES (?,?,?,?)
    `).run(staffId, accountId, `${label} Staff`, `${label.toLowerCase()}@staff.test`);
    db.prepare(`
      INSERT INTO clients (id, account_id, staff_id, name) VALUES (?,?,?,?)
    `).run(clientId, accountId, staffId, `${label} Client`);
    db.prepare(`
      INSERT INTO payments (id, account_id, client_id, amount) VALUES (?,?,?,?)
    `).run(`${accountId}-pay`, accountId, clientId, 100);
    db.prepare(`
      INSERT INTO sessions (id, account_id, client_id, title) VALUES (?,?,?,?)
    `).run(`${accountId}-sess`, accountId, clientId, 'Session');
    db.prepare(`
      INSERT INTO reminders (id, account_id, client_id, remind_at) VALUES (?,?,?,datetime('now'))
    `).run(`${accountId}-rem`, accountId, clientId);
    db.prepare(`
      INSERT INTO tasks (id, account_id, client_id, title) VALUES (?,?,?,?)
    `).run(taskId, accountId, clientId, 'Task');
    db.prepare(`
      INSERT INTO task_history (task_id, user_id, action) VALUES (?,?,?)
    `).run(taskId, accountId, 'created');
    db.prepare(`
      INSERT INTO user_wallets (account_id, balance) VALUES (?,?)
    `).run(accountId, 50);
    db.prepare(`
      INSERT INTO files (id, account_id, filename, path) VALUES (?,?,?,?)
    `).run(`${accountId}-file`, accountId, 'x.bin', '/tmp/x');
    const storageKey = workspaceStorageKey(accountId, 'default');
    db.prepare(`INSERT INTO user_data (account_id, data) VALUES (?,?)`).run(accountId, '{"legacy":true}');
    db.prepare(`
      INSERT INTO user_data_parts (account_id, part_key, data, data_hash) VALUES (?,?,?,?)
    `).run(storageKey, 'students', '[]', 'h1');
    db.prepare(`
      INSERT INTO account_workspaces (owner_account_id, workspace_id, name) VALUES (?,?,?)
    `).run(accountId, 'default', 'Main');
    writeWorkspaceDocument(db, storageKey, { students: [{ id: 1, name: label }] }, { replaceAll: true });
    db.prepare(`INSERT INTO user_data_versions (account_id, data) VALUES (?,?)`).run(storageKey, '{}');
    if (hasTable(db, 'shared_files')) {
      db.prepare(`
        INSERT INTO shared_files (id, owner_account_id, workspace_id, name, size) VALUES (?,?,?,?,?)
      `).run(`${accountId}-shared`, accountId, 'default', 's.bin', 1);
    }
  };

  seedAccount(VICTIM, 'Victim');
  seedAccount(OTHER, 'Other');
}

const hardDeps = {
  deleteWorkspaceDocumentsForAccount,
  deleteStoredFiles: () => {},
  storageDriver: null,
  skipPrePurgeBackup: true,
};

test('hardDeleteAccount succeeds on full schema with foreign keys and removes one account only', () => {
  const db = buildRealDb();
  seedPair(db);
  assert.ok(victimRowCount(db, VICTIM) > 5);
  assert.ok(victimRowCount(db, OTHER) > 5);
  trashAccount(db, VICTIM, 'admin');
  hardDeleteAccount(db, VICTIM, hardDeps);
  assert.equal(victimRowCount(db, VICTIM), 0);
  assert.ok(victimRowCount(db, OTHER) > 5);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('failed hardDeleteAccount leaves victim rows intact (transaction rollback)', () => {
  const db = buildRealDb();
  seedPair(db);
  const beforeVictim = victimRowCount(db, VICTIM);
  const beforeOther = victimRowCount(db, OTHER);
  trashAccount(db, VICTIM, 'admin');
  assert.throws(() => hardDeleteAccount(db, VICTIM, {
    ...hardDeps,
    deleteWorkspaceDocumentsForAccount() {
      throw new Error('simulated_delete_failure');
    },
  }), /simulated_delete_failure/);
  assert.equal(victimRowCount(db, VICTIM), beforeVictim);
  assert.equal(victimRowCount(db, OTHER), beforeOther);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM accounts WHERE id=?', VICTIM), 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('ensurePrePurgeAccountBackup reuses a backup younger than 24 hours', () => {
  const db = buildRealDb();
  seedPair(db);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-purge-reuse-'));
  const t0 = Date.now();
  trashAccount(db, VICTIM, 'admin', { now: t0 });
  const first = ensurePrePurgeAccountBackup(db, VICTIM, { now: t0 + 1000, backupDir });
  const second = ensurePrePurgeAccountBackup(db, VICTIM, { now: t0 + 60_000, backupDir });
  assert.equal(first, second);
  assert.equal(fs.readdirSync(backupDir).filter(name => name.endsWith('.json.gz')).length, 1);
  fs.rmSync(backupDir, { recursive: true, force: true });
});