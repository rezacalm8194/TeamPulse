const path = require('path');
const { createLocalDiskDriver } = require('./localDiskDriver');

function storageRootFromEnv(env = process.env) {
  const configured = String(env.STORAGE_ROOT || './storage').trim() || './storage';
  return path.resolve(__dirname, '..', '..', configured);
}

function createStorageDriver(env = process.env) {
  const kind = String(env.STORAGE_DRIVER || 'local').trim().toLowerCase() || 'local';
  if (kind === 'local') return createLocalDiskDriver(storageRootFromEnv(env));
  const error = new Error(`unsupported_storage_driver:${kind}`);
  error.code = 'unsupported_storage_driver';
  throw error;
}

module.exports = { createStorageDriver, storageRootFromEnv };
