const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLocalDiskDriver } = require('../utils/storage/localDiskDriver');
const { createStorageDriver } = require('../utils/storage');

test('local disk driver stores and deletes objects by key', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-storage-'));
  const driver = createLocalDiskDriver(root);
  await driver.put('user-1/ws/file.bin', Buffer.from('hello'));
  assert.equal(String(await driver.read('user-1/ws/file.bin')), 'hello');
  assert.equal((await driver.stat('user-1/ws/file.bin')).bytes, 5);
  assert.equal(await driver.delete('user-1/ws/file.bin'), true);
  assert.equal(await driver.stat('user-1/ws/file.bin'), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('local disk driver rejects path traversal keys', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-storage-'));
  const driver = createLocalDiskDriver(root);
  await assert.rejects(() => driver.put('../secret.txt', Buffer.from('x')), { code: 'invalid_storage_key' });
  await assert.rejects(() => driver.read('a/../../etc/passwd'), { code: 'invalid_storage_key' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('factory uses local disk and rejects unknown drivers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-storage-factory-'));
  const driver = createStorageDriver({ STORAGE_DRIVER: 'local', STORAGE_ROOT: root });
  assert.equal(driver.kind, 'local');
  assert.equal(path.resolve(driver.root), path.resolve(root));
  assert.throws(
    () => createStorageDriver({ STORAGE_DRIVER: 's3' }),
    { code: 'unsupported_storage_driver' }
  );
  fs.rmSync(root, { recursive: true, force: true });
});
