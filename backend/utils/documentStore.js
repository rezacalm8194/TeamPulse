const { createHash } = require('crypto');
const { isMainThread } = require('worker_threads');

const SCALARS_PART = '__scalars__';
const PARTS_MARKER = '{"_layout":"parts"}';
const ADMIN_SETTINGS_ID = '__admin_settings__';

const readyDbs = new WeakSet();

function partHash(serialized) {
  return createHash('sha256').update(String(serialized || '')).digest('hex');
}

function blobEtag(serialized) {
  return partHash(serialized);
}

function documentEtagFromHashes(hashes) {
  const canonical = Object.keys(hashes || {})
    .sort()
    .map(key => `${key}:${hashes[key]}`)
    .join('|');
  return partHash(canonical);
}

function isSafePartKey(key) {
  if (key === SCALARS_PART) return true;
  return typeof key === 'string' && key.length > 0 && key.length <= 80 && /^[A-Za-z0-9_]+$/.test(key);
}

function isPartsMarker(raw) {
  const text = String(raw || '').trim();
  return text === PARTS_MARKER || text === '{"_layout": "parts"}';
}

function splitDocument(data) {
  const scalars = {};
  const collections = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { scalars, collections };
  }
  Object.keys(data).forEach(key => {
    if (!isSafePartKey(key) && key !== SCALARS_PART) {
      scalars[key] = data[key];
      return;
    }
    if (Array.isArray(data[key])) collections[key] = data[key];
    else scalars[key] = data[key];
  });
  return { scalars, collections };
}

function assembleDocument(scalars, collections) {
  return { ...(scalars && typeof scalars === 'object' ? scalars : {}), ...(collections || {}) };
}

function ensureDocumentStoreSchema(db) {
  if (readyDbs.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_data (
      account_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      data_etag TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_data_parts (
      account_id TEXT NOT NULL,
      part_key TEXT NOT NULL,
      data TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, part_key)
    );
    CREATE INDEX IF NOT EXISTS idx_user_data_parts_account
      ON user_data_parts(account_id);
  `);
  try {
    const cols = db.prepare('PRAGMA table_info(user_data)').all();
    if (cols.length && !cols.some(col => col.name === 'data_etag')) {
      db.exec('ALTER TABLE user_data ADD COLUMN data_etag TEXT');
    }
  } catch (_) { /* user_data may not exist in isolated unit tests */ }
  readyDbs.add(db);
}

function parsePartValue(partKey, raw) {
  try {
    const parsed = JSON.parse(raw || (partKey === SCALARS_PART ? '{}' : '[]'));
    if (partKey === SCALARS_PART) {
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return partKey === SCALARS_PART ? {} : [];
  }
}

function loadPartHashes(db, accountId) {
  ensureDocumentStoreSchema(db);
  const rows = db.prepare(
    'SELECT part_key, data_hash FROM user_data_parts WHERE account_id=?'
  ).all(accountId);
  const hashes = {};
  rows.forEach(row => { hashes[row.part_key] = row.data_hash; });
  return hashes;
}

function hasDocumentParts(db, accountId) {
  ensureDocumentStoreSchema(db);
  return !!db.prepare(
    'SELECT 1 FROM user_data_parts WHERE account_id=? LIMIT 1'
  ).get(accountId);
}

function loadWorkspaceMeta(db, accountId) {
  ensureDocumentStoreSchema(db);
  const row = db.prepare(
    'SELECT account_id,data,data_etag,updated_at FROM user_data WHERE account_id=?'
  ).get(accountId);
  if (!row) return null;
  const parts = hasDocumentParts(db, accountId);
  const layout = parts || isPartsMarker(row.data) ? 'parts' : 'blob';
  let etag = row.data_etag || null;
  if (!etag) {
    etag = layout === 'parts'
      ? documentEtagFromHashes(loadPartHashes(db, accountId))
      : blobEtag(row.data);
  }
  return {
    accountId,
    layout,
    etag,
    updated_at: row.updated_at || null,
    serialized: layout === 'blob' ? row.data : null,
  };
}

function loadDocumentParts(db, accountId, collectionKeys = []) {
  ensureDocumentStoreSchema(db);
  const wanted = new Set([SCALARS_PART]);
  (collectionKeys || []).forEach(key => {
    if (isSafePartKey(key) && key !== SCALARS_PART) wanted.add(key);
  });
  const keys = [...wanted];
  const placeholders = keys.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT part_key, data FROM user_data_parts WHERE account_id=? AND part_key IN (${placeholders})`
  ).all(accountId, ...keys);
  const scalars = {};
  const collections = {};
  rows.forEach(row => {
    const value = parsePartValue(row.part_key, row.data);
    if (row.part_key === SCALARS_PART) Object.assign(scalars, value);
    else collections[row.part_key] = value;
  });
  collectionKeys.forEach(key => {
    if (isSafePartKey(key) && key !== SCALARS_PART && !Object.prototype.hasOwnProperty.call(collections, key)) {
      collections[key] = [];
    }
  });
  return { scalars, collections, data: assembleDocument(scalars, collections) };
}

function loadWorkspaceDocument(db, accountId) {
  const meta = loadWorkspaceMeta(db, accountId);
  if (!meta) return null;
  if (meta.layout === 'parts') {
    const rows = db.prepare(
      'SELECT part_key, data FROM user_data_parts WHERE account_id=?'
    ).all(accountId);
    const scalars = {};
    const collections = {};
    rows.forEach(row => {
      const value = parsePartValue(row.part_key, row.data);
      if (row.part_key === SCALARS_PART) Object.assign(scalars, value);
      else collections[row.part_key] = value;
    });
    return {
      ...meta,
      data: assembleDocument(scalars, collections),
    };
  }
  let data = null;
  try { data = JSON.parse(meta.serialized || 'null'); } catch { data = null; }
  return { ...meta, data };
}

function serializeWorkspaceDocument(db, accountId) {
  const loaded = loadWorkspaceDocument(db, accountId);
  if (!loaded) return '{}';
  if (loaded.serialized) return loaded.serialized;
  return JSON.stringify(loaded.data || {});
}

function upsertPartRow(db, accountId, partKey, json) {
  const hash = partHash(json);
  const prev = db.prepare(
    'SELECT data_hash FROM user_data_parts WHERE account_id=? AND part_key=?'
  ).get(accountId, partKey);
  if (prev?.data_hash === hash) return hash;
  db.prepare(`
    INSERT INTO user_data_parts (account_id, part_key, data, data_hash, updated_at)
    VALUES (?,?,?,?,datetime('now'))
    ON CONFLICT(account_id, part_key) DO UPDATE SET
      data=excluded.data,
      data_hash=excluded.data_hash,
      updated_at=datetime('now')
  `).run(accountId, partKey, json, hash);
  return hash;
}

function upsertUserDataMeta(db, accountId, etag) {
  const existing = db.prepare('SELECT account_id FROM user_data WHERE account_id=?').get(accountId);
  if (existing) {
    db.prepare(
      "UPDATE user_data SET data=?, data_etag=?, updated_at=datetime('now') WHERE account_id=?"
    ).run(PARTS_MARKER, etag, accountId);
  } else {
    db.prepare(
      "INSERT INTO user_data (account_id, data, data_etag, updated_at) VALUES (?,?,?,datetime('now'))"
    ).run(accountId, PARTS_MARKER, etag);
  }
}

function writeWorkspaceDocument(db, accountId, data, { replaceAll = true } = {}) {
  ensureDocumentStoreSchema(db);
  const persist = db.transaction(() => {
    if (accountId === ADMIN_SETTINGS_ID) {
      const serialized = JSON.stringify(data || {});
      const etag = blobEtag(serialized);
      const existing = db.prepare('SELECT account_id FROM user_data WHERE account_id=?').get(accountId);
      if (existing) {
        db.prepare("UPDATE user_data SET data=?, data_etag=?, updated_at=datetime('now') WHERE account_id=?").run(serialized, etag, accountId);
      } else {
        db.prepare("INSERT INTO user_data (account_id, data, data_etag, updated_at) VALUES (?,?,?,datetime('now'))").run(accountId, serialized, etag);
      }
      return { etag, layout: 'blob' };
    }

    const { scalars, collections } = splitDocument(data);
    const hashes = replaceAll ? {} : loadPartHashes(db, accountId);
    hashes[SCALARS_PART] = upsertPartRow(db, accountId, SCALARS_PART, JSON.stringify(scalars));
    const writtenCollections = Object.keys(collections);
    writtenCollections.forEach(key => {
      hashes[key] = upsertPartRow(db, accountId, key, JSON.stringify(collections[key]));
    });
    if (replaceAll) {
      const keep = new Set([SCALARS_PART, ...writtenCollections]);
      db.prepare(
        'SELECT part_key FROM user_data_parts WHERE account_id=?'
      ).all(accountId).forEach(row => {
        if (keep.has(row.part_key)) return;
        db.prepare('DELETE FROM user_data_parts WHERE account_id=? AND part_key=?').run(accountId, row.part_key);
        delete hashes[row.part_key];
      });
    }
    const etag = documentEtagFromHashes(hashes);
    upsertUserDataMeta(db, accountId, etag);
    return { etag, layout: 'parts', hashes };
  });
  return persist();
}

function deleteWorkspaceDocument(db, accountId) {
  ensureDocumentStoreSchema(db);
  db.prepare('DELETE FROM user_data_parts WHERE account_id=?').run(accountId);
  db.prepare('DELETE FROM user_data WHERE account_id=?').run(accountId);
}

function deleteWorkspaceDocumentsForAccount(db, accountId) {
  ensureDocumentStoreSchema(db);
  db.prepare('DELETE FROM user_data_parts WHERE account_id=? OR account_id LIKE ?')
    .run(accountId, `${accountId}::workspace::%`);
  db.prepare('DELETE FROM user_data WHERE account_id=? OR account_id LIKE ?')
    .run(accountId, `${accountId}::workspace::%`);
}

function yieldEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

function documentStoreThread() {
  return require('./documentStoreThread');
}

function shouldOffload(db) {
  return isMainThread && documentStoreThread().canOffloadDocumentStore(db);
}

function isWorkerInfrastructureError(err) {
  const msg = String(err && err.message || '');
  return err?.code === 'ERR_DLOPEN_FAILED'
    || msg.startsWith('document_store_worker')
    || msg.includes('unknown_document_store_method');
}

async function offloadOrInline(db, method, args, inline) {
  if (shouldOffload(db)) {
    try {
      return await documentStoreThread().callDocumentWorker(db, method, args);
    } catch (err) {
      if (isWorkerInfrastructureError(err)) return inline();
      throw err;
    }
  }
  return inline();
}

async function loadWorkspaceMetaAsync(db, accountId) {
  return offloadOrInline(db, 'loadWorkspaceMeta', [accountId], async () => {
    await yieldEventLoop();
    return loadWorkspaceMeta(db, accountId);
  });
}

async function loadDocumentPartsAsync(db, accountId, collectionKeys = []) {
  return offloadOrInline(db, 'loadDocumentParts', [accountId, collectionKeys], async () => {
    ensureDocumentStoreSchema(db);
    const wanted = new Set([SCALARS_PART]);
    (collectionKeys || []).forEach(key => {
      if (isSafePartKey(key) && key !== SCALARS_PART) wanted.add(key);
    });
    const keys = [...wanted];
    const placeholders = keys.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT part_key, data FROM user_data_parts WHERE account_id=? AND part_key IN (${placeholders})`
    ).all(accountId, ...keys);
    const scalars = {};
    const collections = {};
    for (const row of rows) {
      const value = parsePartValue(row.part_key, row.data);
      if (row.part_key === SCALARS_PART) Object.assign(scalars, value);
      else collections[row.part_key] = value;
      await yieldEventLoop();
    }
    collectionKeys.forEach(key => {
      if (isSafePartKey(key) && key !== SCALARS_PART && !Object.prototype.hasOwnProperty.call(collections, key)) {
        collections[key] = [];
      }
    });
    return { scalars, collections, data: assembleDocument(scalars, collections) };
  });
}

async function loadWorkspaceDocumentAsync(db, accountId) {
  return offloadOrInline(db, 'loadWorkspaceDocument', [accountId], async () => {
    const meta = loadWorkspaceMeta(db, accountId);
    if (!meta) return null;
    if (meta.layout === 'parts') {
      const rows = db.prepare(
        'SELECT part_key, data FROM user_data_parts WHERE account_id=?'
      ).all(accountId);
      const scalars = {};
      const collections = {};
      for (const row of rows) {
        const value = parsePartValue(row.part_key, row.data);
        if (row.part_key === SCALARS_PART) Object.assign(scalars, value);
        else collections[row.part_key] = value;
        await yieldEventLoop();
      }
      return { ...meta, data: assembleDocument(scalars, collections) };
    }
    await yieldEventLoop();
    let data = null;
    try { data = JSON.parse(meta.serialized || 'null'); } catch { data = null; }
    return { ...meta, data };
  });
}

async function serializeWorkspaceDocumentAsync(db, accountId) {
  return offloadOrInline(db, 'serializeWorkspaceDocument', [accountId], async () => {
    const loaded = await loadWorkspaceDocumentAsync(db, accountId);
    if (!loaded) return '{}';
    if (loaded.serialized) return loaded.serialized;
    await yieldEventLoop();
    return JSON.stringify(loaded.data || {});
  });
}

async function writeWorkspaceDocumentAsync(db, accountId, data, { replaceAll = true } = {}) {
  return offloadOrInline(db, 'writeWorkspaceDocument', [accountId, data, { replaceAll }], async () => {
    ensureDocumentStoreSchema(db);
    if (accountId === ADMIN_SETTINGS_ID) {
      await yieldEventLoop();
      return writeWorkspaceDocument(db, accountId, data, { replaceAll });
    }
    const { scalars, collections } = splitDocument(data);
    const hashes = replaceAll ? {} : loadPartHashes(db, accountId);
    await yieldEventLoop();
    hashes[SCALARS_PART] = upsertPartRow(db, accountId, SCALARS_PART, JSON.stringify(scalars));
    const writtenCollections = Object.keys(collections);
    for (const key of writtenCollections) {
      hashes[key] = upsertPartRow(db, accountId, key, JSON.stringify(collections[key]));
      await yieldEventLoop();
    }
    if (replaceAll) {
      const keep = new Set([SCALARS_PART, ...writtenCollections]);
      const extra = db.prepare(
        'SELECT part_key FROM user_data_parts WHERE account_id=?'
      ).all(accountId);
      for (const row of extra) {
        if (keep.has(row.part_key)) continue;
        db.prepare('DELETE FROM user_data_parts WHERE account_id=? AND part_key=?').run(accountId, row.part_key);
        delete hashes[row.part_key];
      }
    }
    const etag = documentEtagFromHashes(hashes);
    upsertUserDataMeta(db, accountId, etag);
    return { etag, layout: 'parts', hashes };
  });
}

module.exports = {
  SCALARS_PART,
  PARTS_MARKER,
  blobEtag,
  documentEtagFromHashes,
  splitDocument,
  assembleDocument,
  ensureDocumentStoreSchema,
  loadPartHashes,
  hasDocumentParts,
  loadWorkspaceMeta,
  loadWorkspaceMetaAsync,
  loadDocumentParts,
  loadDocumentPartsAsync,
  loadWorkspaceDocument,
  loadWorkspaceDocumentAsync,
  serializeWorkspaceDocument,
  serializeWorkspaceDocumentAsync,
  writeWorkspaceDocument,
  writeWorkspaceDocumentAsync,
  deleteWorkspaceDocument,
  deleteWorkspaceDocumentsForAccount,
};
