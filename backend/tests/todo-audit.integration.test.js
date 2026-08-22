const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');

const backendDir = path.resolve(__dirname, '..');
const sourceDb = path.join(backendDir, 'database', 'teampulse.db');

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

function auditEntries(logDir) {
  const file = path.join(logDir, 'audit.log');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

test('successful regular and chunk syncs emit todo audit once; rejected syncs emit none', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teampulse-todo-audit-'));
  const testDb = path.join(tempDir, 'test.db');
  const logDir = path.join(tempDir, 'logs');
  fs.copyFileSync(sourceDb, testDb);
  const db = new Database(testDb);
  const userId = 'todo-audit-test-user';
  const email = 'todo-audit@example.test';
  db.prepare('DELETE FROM accounts WHERE id=? OR lower(email)=?').run(userId, email);
  db.prepare('INSERT INTO accounts (id,name,email,password,role,is_active) VALUES (?,?,?,?,?,1)')
    .run(userId, 'Todo Audit Test', email, bcrypt.hashSync('SafePassword123!', 4), 'user');
  // Migration behavior is covered by todo-audit-store.test.js. Keep this API
  // integration test focused on request semantics instead of rescanning the
  // copied production-sized fixture during server startup.
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.prepare('INSERT OR IGNORE INTO app_migrations (name) VALUES (?)')
    .run('todo_audit_occurrence_identity_v2');
  db.close();

  const port = 32194;
  const vapid = webpush.generateVAPIDKeys();
  const serverEnv = {
      ...process.env, PORT: String(port), DB_PATH: testDb, LOG_DIR: logDir,
      JWT_SECRET: 'todo-audit-test-secret', NODE_ENV: 'test',
      VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
  };
  const startServer = () => spawn(process.execPath, ['server.js'], {
    cwd: backendDir, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stopServer = async processToStop => {
    if (processToStop.exitCode != null) return;
    const exited = new Promise(resolve => processToStop.once('exit', resolve));
    processToStop.kill();
    await exited;
  };
  let child = startServer();
  t.after(async () => {
    await stopServer(child);
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await waitForServer(port, child);

  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'SafePassword123!' }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const privateTitle = 'PRIVATE_TODO_TITLE_MUST_NOT_BE_LOGGED';
  const todo = {
    id: 501, title: privateTitle, note: 'PRIVATE_NOTE', staff_report: 'PRIVATE_REPORT',
    done: false, status: 'pending', assignee_id: 12, priority: 'medium',
  };

  const initial = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ force: true, data: { todos: [todo], students: [{ id: 1 }, { id: 2 }, { id: 3 }] } }),
  });
  assert.equal(initial.status, 200);
  const initialBody = await initial.json();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(auditEntries(logDir).filter(entry => entry.event === 'todo_created').length, 1);

  const chunkPayload = JSON.stringify({
    base_etag: initialBody.etag,
    data: { todos: [{ ...todo, done: true, status: 'completed', done_at: '2026-08-18T01:00:00Z' }], students: [{ id: 1 }, { id: 2 }, { id: 3 }] },
  });
  const cut1 = Math.ceil(chunkPayload.length / 3);
  const chunks = [chunkPayload.slice(0, cut1), chunkPayload.slice(cut1, cut1 * 2), chunkPayload.slice(cut1 * 2)];
  for (let index = 0; index < chunks.length; index += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/data/${userId}/chunks`, {
      method: 'POST', headers,
      body: JSON.stringify({ upload_id: 'todo-audit-upload', index, total: chunks.length, chunk: chunks[index] }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    if (index < chunks.length - 1) assert.equal(body.complete, false);
  }
  await new Promise(resolve => setTimeout(resolve, 150));
  let entries = auditEntries(logDir);
  assert.equal(entries.filter(entry => entry.event === 'todo_completed' && entry.entityId === '501').length, 1);
  assert.equal(entries.filter(entry => entry.event === 'todo_updated' && entry.entityId === '501').length, 0);

  const recurringRoot = { id: 1000, repeat: 'daily', done: false, status: 'pending' };
  const snapshot1001 = {
    id: 1001, recurrence_parent_id: 1000, scheduled_date: '1405/05/27',
    _snapshot: true, archived: true, done: true, status: 'completed',
    title: privateTitle, description: 'PRIVATE_DESCRIPTION', note: 'PRIVATE_NOTE', report: 'PRIVATE_REPORT',
  };
  const snapshot1002 = { ...snapshot1001, id: 1002, scheduled_date: '1405/05/28' };
  let current = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, { headers: { authorization: `Bearer ${token}` } });
  let currentBody = await current.json();
  const recurringData = {
    ...currentBody.data,
    todos: [...currentBody.data.todos, recurringRoot, snapshot1001, snapshot1002],
  };
  let response = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers, body: JSON.stringify({ base_etag: currentBody.etag, data: recurringData }),
  });
  assert.equal(response.status, 200);
  let responseBody = await response.json();
  await new Promise(resolve => setTimeout(resolve, 150));
  entries = auditEntries(logDir);
  const recurringEntries = entries.filter(entry => entry.event === 'todo_completed' && ['1001', '1002'].includes(entry.entityId));
  assert.equal(recurringEntries.length, 2);
  assert.deepEqual(recurringEntries.map(entry => entry.metadata.rootTodoId), ['1000', '1000']);
  assert.deepEqual(recurringEntries.map(entry => entry.metadata.occurrence), ['1405/05/27', '1405/05/28']);

  // An unchanged re-sync, followed by remove/re-add, must not create another
  // immutable occurrence completion event.
  response = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers, body: JSON.stringify({ base_etag: responseBody.etag, data: recurringData }),
  });
  responseBody = await response.json();
  const without1001 = { ...recurringData, todos: recurringData.todos.filter(todoItem => todoItem.id !== 1001) };
  response = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers, body: JSON.stringify({ base_etag: responseBody.etag, data: without1001 }),
  });
  responseBody = await response.json();
  response = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers, body: JSON.stringify({ base_etag: responseBody.etag, data: recurringData }),
  });
  responseBody = await response.json();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(auditEntries(logDir).filter(entry => entry.event === 'todo_completed' && entry.entityId === '1001').length, 1);

  // A real process restart must preserve the recurring dedupe record.
  await stopServer(child);
  child = startServer();
  await waitForServer(port, child);
  response = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers, body: JSON.stringify({ base_etag: responseBody.etag, data: recurringData }),
  });
  assert.equal(response.status, 200);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(auditEntries(logDir).filter(entry => entry.event === 'todo_completed' && entry.entityId === '1001').length, 1);

  const countOutboxRows = () => {
    const readonlyDb = new Database(testDb, { readonly: true });
    const count = readonlyDb.prepare('SELECT COUNT(*) AS count FROM todo_audit_events').get().count;
    readonlyDb.close();
    return count;
  };
  current = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, { headers: { authorization: `Bearer ${token}` } });
  currentBody = await current.json();
  const staleCollision = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({
      base_etag: currentBody.etag,
      data: {
        ...currentBody.data,
        _todoIdHighWater: 0,
        todos: [...currentBody.data.todos, { id: 400, title: 'stale client todo', done: false, status: 'pending' }],
      },
    }),
  });
  assert.equal(staleCollision.status, 409);
  const staleCollisionBody = await staleCollision.json();
  assert.equal(staleCollisionBody.error, 'todo_id_collision');
  assert.ok(staleCollisionBody.todo_id_high_water >= 1002);

  // A current client that has acknowledged the server high-water may restore
  // historical non-recurring todos below that mark. This is not a new ID
  // allocation; genuinely new IDs are allocated above the acknowledged mark.
  const restoredHistorical = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({
      base_etag: currentBody.etag,
      data: {
        ...currentBody.data,
        todos: [
          ...currentBody.data.todos,
          { id: 400, title: 'restored historical todo', done: false, status: 'pending' },
          { id: 401, title: 'another restored historical todo', done: false, status: 'pending' },
        ],
      },
    }),
  });
  assert.equal(restoredHistorical.status, 200);
  const beforeRejectedOutbox = countOutboxRows();
  const conflict = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ base_etag: 'stale-etag', data: { todos: [{ ...todo, title: 'conflicting title' }], students: [{ id: 1 }, { id: 2 }, { id: 3 }] } }),
  });
  assert.equal(conflict.status, 409);

  current = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(current.status, 200);
  currentBody = await current.json();
  const destructive = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ base_etag: currentBody.etag, data: { todos: [] } }),
  });
  assert.equal(destructive.status, 409);
  assert.equal((await destructive.json()).error, 'destructive_overwrite_blocked');

  const forcedStale = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ force: true, base_etag: 'stale-etag', data: { todos: [] } }),
  });
  assert.equal(forcedStale.status, 409);
  assert.equal((await forcedStale.json()).error, 'sync_conflict');

  await new Promise(resolve => setTimeout(resolve, 150));
  entries = auditEntries(logDir);
  const verificationDb = new Database(testDb, { readonly: true });
  assert.equal(verificationDb.prepare("SELECT COUNT(*) AS count FROM todo_audit_events WHERE status='pending'").get().count, 0);
  verificationDb.close();
  assert.equal(countOutboxRows(), beforeRejectedOutbox);
  const serialized = JSON.stringify(entries);
  for (const forbidden of [privateTitle, 'PRIVATE_NOTE', 'PRIVATE_DESCRIPTION', 'PRIVATE_REPORT', token]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
