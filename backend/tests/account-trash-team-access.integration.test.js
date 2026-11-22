const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const {
  ensureAccountTrashSchema,
  trashAccount,
  restoreAccount,
} = require('../utils/accountTrash');
const { ensureTeamAccessSchema, workspaceStorageKey } = require('../utils/teamAccessSchema');
const { ensureDocumentStoreSchema, writeWorkspaceDocument } = require('../utils/documentStore');
const { ensureSharedFilesSchema } = require('../utils/fileStore');

const backendDir = path.resolve(__dirname, '..');

async function waitForServer(port, child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode != null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server did not become ready');
}

test('team grant loses data and file access while owner is in account trash', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-acct-trash-team-'));
  const testDb = path.join(tempDir, 'test.db');
  const db = new Database(testDb);
  const ownerId = 'owner-trash-team';
  const memberId = 'member-trash-team';
  const ownerEmail = 'owner-trash-team@example.test';
  const memberEmail = 'member-trash-team@example.test';
  const pass = bcrypt.hashSync('TeamAccess123!', 4);
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, email TEXT, password TEXT, name TEXT, role TEXT DEFAULT 'owner',
      is_active INTEGER DEFAULT 1, token_version INTEGER DEFAULT 0,
      business_name TEXT, business_type TEXT, plan TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS account_workspaces (
      owner_account_id TEXT NOT NULL, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_account_id, workspace_id)
    );
  `);
  db.prepare('INSERT INTO account_workspaces (owner_account_id, workspace_id, name) VALUES (?,?,?)')
    .run(ownerId, 'default', 'میزکار اصلی');
  ensureAccountTrashSchema(db);
  ensureTeamAccessSchema(db);
  ensureDocumentStoreSchema(db);
  ensureSharedFilesSchema(db);
  db.prepare('INSERT INTO accounts (id,email,password,name,role) VALUES (?,?,?,?,?)').run(
    ownerId, ownerEmail, pass, 'Owner', 'owner'
  );
  db.prepare('INSERT INTO accounts (id,email,password,name,role) VALUES (?,?,?,?,?)').run(
    memberId, memberEmail, pass, 'Member', 'owner'
  );
  db.prepare(`
    INSERT INTO team_access_grants (owner_account_id, workspace_id, member_email, status, permissions)
    VALUES (?, 'default', ?, 'active', '[]')
  `).run(ownerId, memberEmail);
  writeWorkspaceDocument(db, workspaceStorageKey(ownerId, 'default'), {
    students: [{ id: 1, name: 'Customer' }],
    meta: { appTitle: 'Team Test' },
  }, { replaceAll: true });
  db.prepare(`
    INSERT INTO shared_files (id, owner_account_id, workspace_id, name, mime_type, size, storage_key, sha256)
    VALUES ('file-team-1', ?, 'default', 'keep.bin', 'application/octet-stream', 4, 'objects/keep', 'deadbeef')
  `).run(ownerId);
  db.close();

  const port = 32217;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: testDb,
      JWT_SECRET: 'account-trash-team-test-secret',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode == null) child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  });
  await waitForServer(port, child);

  const loginMember = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: memberEmail, password: 'TeamAccess123!' }),
  });
  assert.equal(loginMember.status, 200);
  const memberToken = (await loginMember.json()).token;
  const auth = { authorization: `Bearer ${memberToken}` };

  const readBefore = await fetch(
    `http://127.0.0.1:${port}/api/data/${encodeURIComponent(ownerId)}?workspace=default`,
    { headers: auth }
  );
  assert.equal(readBefore.status, 200);

  const dbLive = new Database(testDb);
  trashAccount(dbLive, ownerId, 'admin', { now: Date.now() });
  dbLive.close();

  const readTrashed = await fetch(
    `http://127.0.0.1:${port}/api/data/${encodeURIComponent(ownerId)}?workspace=default`,
    { headers: auth }
  );
  assert.ok(readTrashed.status === 403 || readTrashed.status === 404);

  const saveTrashed = await fetch(
    `http://127.0.0.1:${port}/api/data/${encodeURIComponent(ownerId)}?workspace=default`,
    {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ students: [], meta: { appTitle: 'hack' } }),
    }
  );
  assert.ok(saveTrashed.status === 403 || saveTrashed.status === 404);

  const downloadTrashed = await fetch(`http://127.0.0.1:${port}/api/files/file-team-1`, { headers: auth });
  assert.equal(downloadTrashed.status, 403);

  const deleteTrashed = await fetch(`http://127.0.0.1:${port}/api/files/file-team-1`, {
    method: 'DELETE',
    headers: auth,
  });
  assert.equal(deleteTrashed.status, 403);

  const dbCheck = new Database(testDb);
  assert.equal(
    dbCheck.prepare('SELECT COUNT(*) AS n FROM shared_files WHERE id=?').get('file-team-1').n,
    1,
    'shared_files row must survive blocked delete'
  );
  dbCheck.close();

  const dbRestore = new Database(testDb);
  restoreAccount(dbRestore, ownerId);
  dbRestore.close();

  const readAfter = await fetch(
    `http://127.0.0.1:${port}/api/data/${encodeURIComponent(ownerId)}?workspace=default`,
    { headers: auth }
  );
  assert.equal(readAfter.status, 200);
});