'use strict';

const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');
const store = require('./documentStore');

const db = new Database(workerData.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 8000');
store.ensureDocumentStoreSchema(db);

const METHODS = new Set([
  'loadWorkspaceMeta',
  'loadDocumentParts',
  'loadWorkspaceDocument',
  'serializeWorkspaceDocument',
  'writeWorkspaceDocument',
]);

parentPort.on('message', msg => {
  const { id, method, args } = msg || {};
  try {
    if (!METHODS.has(method) || typeof store[method] !== 'function') {
      throw new Error(`unknown_document_store_method:${method}`);
    }
    const result = store[method](db, ...(Array.isArray(args) ? args : []));
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      error: { message: error.message || String(error), code: error.code || null },
    });
  }
});
