'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

const clients = new Map();
const disabledPaths = new Set();

function isFileDb(db) {
  const name = db && typeof db.name === 'string' ? db.name : '';
  return !!name && name !== ':memory:' && !name.includes('mode=memory');
}

function resolveDbPath(db) {
  return path.resolve(db.name);
}

function failAll(client, err) {
  for (const pending of client.pending.values()) {
    pending.reject(err);
  }
  client.pending.clear();
}

function spawn(dbPath) {
  const client = {
    dbPath,
    worker: null,
    pending: new Map(),
    seq: 0,
  };
  const worker = new Worker(path.join(__dirname, 'documentStoreWorker.js'), {
    workerData: { dbPath },
  });
  client.worker = worker;
  worker.on('message', msg => {
    const pending = client.pending.get(msg.id);
    if (!pending) return;
    client.pending.delete(msg.id);
    if (msg.error) {
      const err = new Error(msg.error.message);
      if (msg.error.code) err.code = msg.error.code;
      pending.reject(err);
      return;
    }
    pending.resolve(msg.result);
  });
  worker.on('error', err => {
    disabledPaths.add(dbPath);
    failAll(client, err);
    clients.delete(dbPath);
  });
  worker.on('exit', code => {
    if (client.pending.size) {
      failAll(client, new Error(`document_store_worker_exit:${code}`));
    }
    if (code && code !== 0) disabledPaths.add(dbPath);
    if (clients.get(dbPath) === client) clients.delete(dbPath);
  });
  return client;
}

function getClient(db) {
  const dbPath = resolveDbPath(db);
  let client = clients.get(dbPath);
  if (!client || !client.worker) {
    client = spawn(dbPath);
    clients.set(dbPath, client);
  }
  return client;
}

function canOffloadDocumentStore(db) {
  const { isMainThread } = require('worker_threads');
  if (!isMainThread || !isFileDb(db)) return false;
  return !disabledPaths.has(resolveDbPath(db));
}

function callDocumentWorker(db, method, args) {
  const client = getClient(db);
  const id = ++client.seq;
  return new Promise((resolve, reject) => {
    client.pending.set(id, { resolve, reject });
    try {
      client.worker.postMessage({ id, method, args });
    } catch (err) {
      client.pending.delete(id);
      reject(err);
    }
  });
}

async function shutdownDocumentStoreWorkers() {
  const pending = [...clients.values()].map(client => {
    clients.delete(client.dbPath);
    failAll(client, new Error('document_store_worker_shutdown'));
    return client.worker.terminate();
  });
  await Promise.all(pending);
}

module.exports = {
  canOffloadDocumentStore,
  callDocumentWorker,
  shutdownDocumentStoreWorkers,
};
