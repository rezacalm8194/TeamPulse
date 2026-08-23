const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');
const { classifySyncOutcome } = require('../utils/logger');

const backendDir = path.resolve(__dirname, '..');
const sourceDb = path.join(backendDir, 'database', 'teampulse.db');

async function waitForServer(url, child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode != null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server did not become ready');
}

test('application logging scenarios are structured and redact secrets', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teampulse-logging-'));
  const testDb = path.join(tempDir, 'test.db');
  const logDir = path.join(tempDir, 'logs');
  fs.copyFileSync(sourceDb, testDb);
  let db;
  try {
    db = new Database(testDb);
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    t.skip(`better-sqlite3 native binary is incompatible with this test runtime: ${error.code || error.message}`);
    return;
  }
  const userId = 'logging-test-user';
  db.prepare('DELETE FROM accounts WHERE id=? OR lower(email)=?').run(userId, 'logging-test@example.test');
  db.prepare(`INSERT INTO accounts (id,name,email,password,role,is_active) VALUES (?,?,?,?,?,1)`)
    .run(userId, 'Logging Test', 'logging-test@example.test', bcrypt.hashSync('SafePassword123!', 4), 'user');
  db.close();

  const port = 32191;
  const vapid = webpush.generateVAPIDKeys();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: testDb,
      LOG_DIR: logDir,
      JWT_SECRET: 'integration-test-secret',
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      NODE_ENV: 'test',
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
  await waitForServer(`http://127.0.0.1:${port}/api/health`, child);

  const failedLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'logging-test@example.test', password: 'wrong-password' }),
  });
  assert.equal(failedLogin.status, 401);

  const successfulLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'login-request' },
    body: JSON.stringify({ email: 'logging-test@example.test', password: 'SafePassword123!' }),
  });
  assert.equal(successfulLogin.status, 200);
  assert.equal(successfulLogin.headers.get('x-request-id'), 'login-request');
  const { token } = await successfulLogin.json();

  const unauthorized = await fetch(`http://127.0.0.1:${port}/api/tasks`);
  assert.equal(unauthorized.status, 401);

  const created = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Logging test task', assignee_id: userId }),
  });
  assert.equal(created.status, 410);
  const retired = await created.json();
  assert.equal(retired.error, 'legacy_route_retired');
  assert.equal(retired.use, '/api/data');

  const syncPayloadMarker = 'SYNC_PAYLOAD_MUST_NOT_APPEAR_IN_LOGS';
  const syncSuccess = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      cookie: 'session=sensitive-cookie-value',
      'x-refresh-token': 'sensitive-refresh-token-value',
    },
    body: JSON.stringify({ data: { todos: [], verificationMarker: syncPayloadMarker }, force: true }),
  });
  assert.equal(syncSuccess.status, 200);

  const syncFailure = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    headers: { authorization: 'Bearer deliberately.invalid.token' },
  });
  assert.equal(syncFailure.status, 401);

  const syncConflict = await fetch(`http://127.0.0.1:${port}/api/data/${userId}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ base_etag: 'stale-etag', data: { todos: [] } }),
  });
  assert.equal(syncConflict.status, 409);

  const apiError = await fetch(`http://127.0.0.1:${port}/api/clients`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: { invalid: 'binding' } }),
  });
  assert.equal(apiError.status, 410);

  await new Promise(resolve => setTimeout(resolve, 300));
  const appLog = fs.readFileSync(path.join(logDir, 'app.log'), 'utf8');
  const auditLog = fs.readFileSync(path.join(logDir, 'audit.log'), 'utf8');
  const errorLogPath = path.join(logDir, 'error.log');
  const errorLog = fs.existsSync(errorLogPath) ? fs.readFileSync(errorLogPath, 'utf8') : '';
  for (const line of `${appLog}\n${auditLog}\n${errorLog}`.split(/\r?\n/).filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
  ['login_failed', 'login_success', 'unauthorized_access', 'legacy_route_retired', 'sync_success', 'sync_conflict']
    .forEach(event => assert.match(`${appLog}${auditLog}${errorLog}`, new RegExp(`"event":"${event}"`)));
  for (const secret of [
    'SafePassword123!',
    'wrong-password',
    'deliberately.invalid.token',
    token,
    'sensitive-cookie-value',
    'sensitive-refresh-token-value',
    syncPayloadMarker,
  ]) assert.equal(`${appLog}${auditLog}${errorLog}`.includes(secret), false);
  const appEntries = appLog.trim().split(/\r?\n/).map(JSON.parse);
  const errorEntries = errorLog.trim() ? errorLog.trim().split(/\r?\n/).map(JSON.parse) : [];
  const auditEntries = auditLog.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(appEntries.filter(entry => entry.event === 'api_error').length, 0);
  assert.equal(errorEntries.filter(entry => entry.event === 'api_error').length, 0);
  assert.equal(appEntries.filter(entry => entry.event === 'sync_failed').length, 0);
  assert.equal(errorEntries.filter(entry => entry.event === 'sync_conflict').length, 0);
  assert.deepEqual(classifySyncOutcome(200), { level: 'info', event: 'sync_success' });
  assert.equal(classifySyncOutcome(401), null);
  assert.deepEqual(classifySyncOutcome(409), { level: 'warn', event: 'sync_conflict' });
  assert.deepEqual(classifySyncOutcome(500), { level: 'error', event: 'sync_failed' });
  assert.equal(auditEntries.filter(entry => entry.event === 'legacy_route_retired').length, 2);
  assert.equal(auditEntries.filter(entry => entry.event === 'task_created').length, 0);
  assert.equal(auditEntries.filter(entry => entry.event === 'task_assigned').length, 0);
});
