const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teampulse-logger-unit-'));
process.env.LOG_DIR = tempDir;
process.env.LOG_MAX_BYTES = '65536';
const { logger, sanitize } = require('../utils/logger');

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('sanitize recursively redacts sensitive values', () => {
  const clean = sanitize({
    password: 'secret-password',
    nested: { accessToken: 'secret-token', safe: 'Bearer abc.def.ghi', url: '/x?token=raw-secret' },
    authorization: 'Bearer another-token',
  });
  assert.equal(clean.password, '[REDACTED]');
  assert.equal(clean.nested.accessToken, '[REDACTED]');
  assert.equal(clean.nested.safe, 'Bearer [REDACTED]');
  assert.equal(clean.nested.url, '/x?token=[REDACTED]');
  assert.equal(clean.authorization, '[REDACTED]');
});

test('logger writes structured application, error and audit JSONL files', async () => {
  logger.info('unit_info', { requestId: 'req-1' });
  logger.error('unit_error', { error: new Error('safe failure') });
  logger.audit('unit_audit', { actorUserId: 'user-1', entityType: 'task', entityId: 'task-1' });
  await new Promise(resolve => setTimeout(resolve, 100));
  for (const name of ['app.log', 'error.log', 'audit.log']) {
    const lines = fs.readFileSync(path.join(tempDir, name), 'utf8').trim().split(/\r?\n/);
    lines.forEach(line => assert.doesNotThrow(() => JSON.parse(line)));
  }
});

test('rotation keeps a bounded numbered history', async () => {
  const appLog = path.join(tempDir, 'app.log');
  fs.writeFileSync(appLog, 'x'.repeat(70000));
  logger.info('rotation_triggered', {});
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(fs.existsSync(`${appLog}.1`), true);
  assert.match(fs.readFileSync(appLog, 'utf8'), /rotation_triggered/);
});

test('an unwritable log destination fails safely without a loop or process crash', () => {
  const invalidLogDir = path.join(tempDir, 'not-a-directory');
  fs.writeFileSync(invalidLogDir, 'blocking file');
  const result = spawnSync(process.execPath, ['-e', "require('./utils/logger').logger.info('permission_failure_probe')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, LOG_DIR: invalidLogDir },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.match(result.stderr, /\[logger\] write failed:/);
});
