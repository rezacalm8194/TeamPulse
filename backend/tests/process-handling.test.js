const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const webpush = require('web-push');

const backendDir = path.resolve(__dirname, '..');
const sourceDb = path.join(backendDir, 'database', 'teampulse.db');

function startServer({ port, dbPath, logDir, crash }) {
  const vapid = webpush.generateVAPIDKeys();
  const trigger = crash === 'unhandledRejection'
    ? "setTimeout(()=>Promise.reject(new Error('verification-unhandled')),300)"
    : crash === 'uncaughtException'
      ? "setTimeout(()=>{throw new Error('verification-uncaught')},300)"
      : crash === 'plannedRestart'
        ? 'setTimeout(()=>process.exit(0),800)'
      : '';
  const child = spawn(process.execPath, ['-e', `require('./server');${trigger}`], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(port), DB_PATH: dbPath, LOG_DIR: logDir,
      JWT_SECRET: 'process-test-secret', NODE_ENV: 'test',
      VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.capturedOutput = '';
  child.stdout.on('data', chunk => { child.capturedOutput += chunk; });
  child.stderr.on('data', chunk => { child.capturedOutput += chunk; });
  return child;
}

async function waitForHealth(port, child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode != null) throw new Error(`server exited before health check: ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('health check timeout');
}

function waitForExit(child, timeoutMs = 10000) {
  if (child.exitCode != null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`process exit timeout: ${child.capturedOutput}`)), timeoutMs);
    timer.unref();
    child.once('exit', code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitForLogEvent(logDir, event, timeoutMs = 5000) {
  const errorLogPath = path.join(logDir, 'error.log');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(errorLogPath) && fs.readFileSync(errorLogPath, 'utf8').includes(`"event":"${event}"`)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for log event ${event}`);
}

async function stop(child) {
  if (child.exitCode != null) return;
  const exited = waitForExit(child, 3000);
  child.kill();
  try {
    await exited;
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 3000);
  }
}

test('logs survive server restart and fatal process events terminate cleanly', { timeout: 30000 }, async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teampulse-process-'));
  const dbPath = path.join(tempDir, 'test.db');
  const logDir = path.join(tempDir, 'logs');
  fs.copyFileSync(sourceDb, dbPath);
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(stop));
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const first = startServer({ port: 32211, dbPath, logDir, crash: 'plannedRestart' });
  children.push(first);
  await waitForHealth(32211, first);
  assert.equal(await waitForExit(first), 0);
  const second = startServer({ port: 32211, dbPath, logDir, crash: 'plannedRestart' });
  children.push(second);
  await waitForHealth(32211, second);
  assert.equal(await waitForExit(second), 0);

  const uncaught = startServer({ port: 32212, dbPath, logDir, crash: 'uncaughtException' });
  children.push(uncaught);
  assert.equal(await waitForExit(uncaught), 1, 'uncaughtException must terminate with exit code 1');
  assert.match(fs.readFileSync(path.join(logDir, 'error.log'), 'utf8'), /"event":"uncaught_exception"/);

  const rejected = startServer({ port: 32213, dbPath, logDir, crash: 'unhandledRejection' });
  children.push(rejected);
  await waitForHealth(32213, rejected);
  await waitForLogEvent(logDir, 'unhandled_rejection');
  assert.equal(rejected.exitCode, null, 'unhandledRejection must not terminate the process');
  await waitForHealth(32213, rejected);

  for (const file of ['app.log', 'error.log', 'audit.log']) {
    const filePath = path.join(logDir, file);
    if (file === 'audit.log' && !fs.existsSync(filePath)) fs.writeFileSync(filePath, '');
    fs.appendFileSync(filePath, '');
    assert.equal(fs.statSync(filePath).isFile(), true);
  }
  const appLog = fs.readFileSync(path.join(logDir, 'app.log'), 'utf8');
  assert.ok((appLog.match(/"event":"application_started"/g) || []).length >= 2);
  appLog.trim().split(/\r?\n/).forEach(line => assert.doesNotThrow(() => JSON.parse(line)));
});
