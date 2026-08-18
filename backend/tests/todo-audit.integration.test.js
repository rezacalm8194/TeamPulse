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
  db.close();

  const port = 32194;
  const vapid = webpush.generateVAPIDKeys();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env, PORT: String(port), DB_PATH: testDb, LOG_DIR: logDir,
      JWT_SECRET: 'todo-audit-test-secret', NODE_ENV: 'test',
      VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode == null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
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

  const beforeRejected = entries.length;
  const conflict = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ base_etag: 'stale-etag', data: { todos: [{ ...todo, title: 'conflicting title' }], students: [{ id: 1 }, { id: 2 }, { id: 3 }] } }),
  });
  assert.equal(conflict.status, 409);

  const current = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(current.status, 200);
  const currentBody = await current.json();
  const destructive = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ base_etag: currentBody.etag, data: { todos: [] } }),
  });
  assert.equal(destructive.status, 409);
  assert.equal((await destructive.json()).error, 'destructive_overwrite_blocked');

  await new Promise(resolve => setTimeout(resolve, 150));
  entries = auditEntries(logDir);
  assert.equal(entries.length, beforeRejected);
  const serialized = JSON.stringify(entries);
  for (const forbidden of [privateTitle, 'PRIVATE_NOTE', 'PRIVATE_REPORT', token]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
