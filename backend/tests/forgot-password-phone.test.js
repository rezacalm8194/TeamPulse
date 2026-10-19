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
const repoRoot = path.resolve(backendDir, '..');
const schemaSql = fs.readFileSync(path.join(backendDir, 'database', 'schema.sql'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');

async function waitForServer(url, child, output) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode != null) {
      throw new Error(`server exited with ${child.exitCode}\n${output.text}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready\n${output.text}`);
}

test('forgot-password form uses the registered phone instead of an email link', () => {
  assert.match(appSource, /\/api\/auth\/forgot-password/);
  assert.match(appSource, /function _doReset\(/);
  assert.match(appSource, /_normalizeAuthPhone\(document\.getElementById\('auth-phone'\)/);
  assert.doesNotMatch(appSource, /ارسال لینک بازیابی/);
  assert.doesNotMatch(appSource, /برای تغییر رمز با پشتیبانی تماس بگیرید/);
});

test('phone reset replaces the password and old login stops working', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teampulse-forgot-pw-'));
  const testDb = path.join(tempDir, 'test.db');
  const logDir = path.join(tempDir, 'logs');
  let db;
  try {
    db = new Database(testDb);
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    t.skip(`better-sqlite3 native binary is incompatible with this test runtime: ${error.code || error.message}`);
    return;
  }
  db.exec(schemaSql);
  const userId = 'forgot-phone-user';
  const email = 'forgot-phone@example.test';
  const phone = '09123334455';
  db.prepare('INSERT INTO accounts (id,name,email,phone,password,role,is_active) VALUES (?,?,?,?,?,?,1)')
    .run(userId, 'Forgot Phone', email, phone, bcrypt.hashSync('OldPassword123!', 4), 'user');
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.prepare('INSERT OR IGNORE INTO app_migrations (name) VALUES (?)').run('todo_audit_occurrence_identity_v2');
  db.close();

  const port = 32201;
  const vapid = webpush.generateVAPIDKeys();
  const output = { text: '' };
  const child = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: testDb,
      LOG_DIR: logDir,
      JWT_SECRET: 'forgot-password-test-secret',
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output.text += chunk; });
  child.stderr.on('data', chunk => { output.text += chunk; });
  t.after(async () => {
    if (child.exitCode == null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await waitForServer(`http://127.0.0.1:${port}/api/health`, child, output);

  const missing = await fetch(`http://127.0.0.1:${port}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '09120000000', new_password: 'NewPassword123!' }),
  });
  assert.equal(missing.status, 404);

  const shortPass = await fetch(`http://127.0.0.1:${port}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, new_password: 'short' }),
  });
  assert.equal(shortPass.status, 400);

  const reset = await fetch(`http://127.0.0.1:${port}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '+989123334455', new_password: 'NewPassword123!' }),
  });
  assert.equal(reset.status, 200);
  const resetBody = await reset.json();
  assert.equal(resetBody.success, true);

  const oldLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'OldPassword123!' }),
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'NewPassword123!' }),
  });
  assert.equal(newLogin.status, 200);
});
