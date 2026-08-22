const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { writeWorkspaceDocument, loadWorkspaceDocument, ensureDocumentStoreSchema } = require('../utils/documentStore');
const { workspaceStorageKey } = require('../utils/teamAccessSchema');
const {
  collectAccountAppBackup,
  hasAppDocumentPayload,
  restoreAccountAppBackup,
} = require('../utils/userBackup');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_data (
      account_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE clients (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      name TEXT
    );
    CREATE TABLE payments (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      amount INTEGER
    );
  `);
  ensureDocumentStoreSchema(db);
  return db;
}

test('user backup exports the app document, not empty relational tables', () => {
  const db = makeDb();
  const account = { id: 'acc-1', name: 'Reza', email: 'reza@example.test', plan: 'pro' };
  writeWorkspaceDocument(db, account.id, {
    students: [{ id: 7, name: 'Ali' }],
    payments: [{ id: 3, amount: 50000 }],
    todos: [{ id: 11, title: 'call' }],
    theme: 'dark',
  }, { replaceAll: true });

  const backup = collectAccountAppBackup(db, account, '2026-08-22T00:00:00.000Z');

  assert.equal(backup.meta.type, 'user-app-backup');
  assert.equal(backup.meta.source, 'user_data');
  assert.equal(backup.meta.item_counts.students, 1);
  assert.equal(backup.meta.item_counts.payments, 1);
  assert.equal(backup.app_data.students[0].name, 'Ali');
  assert.equal(backup.app_data.theme, 'dark');
  assert.equal(backup.workspaces[0].id, 'default');
  assert.equal('clients' in backup, false);
  assert.equal('payments' in backup, false);
  assert.equal('legacy_tables' in backup, false);
});

test('legacy relational rows are attached only when they actually exist', () => {
  const db = makeDb();
  const account = { id: 'acc-1', name: 'Reza', email: 'reza@example.test' };
  writeWorkspaceDocument(db, account.id, { students: [{ id: 1 }] }, { replaceAll: true });
  db.prepare('INSERT INTO clients (id, account_id, name) VALUES (?,?,?)').run('c1', 'acc-1', 'orphan');

  const backup = collectAccountAppBackup(db, account);
  assert.equal(backup.legacy_tables.clients[0].name, 'orphan');
  assert.equal('payments' in (backup.legacy_tables || {}), false);
});

test('old relational backup files are rejected as missing the app document', () => {
  assert.equal(hasAppDocumentPayload({
    meta: { version: '1.0.0', account_id: 'acc-1' },
    clients: [],
    payments: [],
  }), false);
  assert.equal(hasAppDocumentPayload({
    meta: { type: 'user-app-backup' },
    app_data: { students: [{ id: 1 }] },
  }), true);
});

test('import restores the JSON account document into user_data', () => {
  const db = makeDb();
  writeWorkspaceDocument(db, 'acc-1', { students: [{ id: 1, name: 'old' }] }, { replaceAll: true });

  const imported = restoreAccountAppBackup(db, 'acc-1', {
    app_data: { students: [{ id: 2, name: 'new' }], payments: [{ id: 9 }] },
  });
  assert.equal(imported.restored_workspaces, 1);
  const loaded = loadWorkspaceDocument(db, 'acc-1');
  assert.equal(loaded.data.students[0].name, 'new');
  assert.equal(loaded.data.payments.length, 1);
});

test('import restores extra workspaces into their storage keys', () => {
  const db = makeDb();
  const extraId = 'acc_otherbiz';
  restoreAccountAppBackup(db, 'acc-1', {
    workspaces: [
      { id: 'default', data: { students: [{ id: 1 }] } },
      { id: extraId, name: 'شعبه ۲', data: { todos: [{ id: 44 }] } },
    ],
  });
  assert.equal(loadWorkspaceDocument(db, 'acc-1').data.students[0].id, 1);
  assert.equal(
    loadWorkspaceDocument(db, workspaceStorageKey('acc-1', extraId)).data.todos[0].id,
    44
  );
  const row = db.prepare(
    'SELECT name FROM account_workspaces WHERE owner_account_id=? AND workspace_id=?'
  ).get('acc-1', extraId);
  assert.equal(row.name, 'شعبه ۲');
});
