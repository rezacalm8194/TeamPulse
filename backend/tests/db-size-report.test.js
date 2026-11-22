const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { buildDbSizeReport } = require('../scripts/db-size-report');
const { ensureVersionSnapshotSchema } = require('../utils/versionSnapshots');

const backendDir = path.resolve(__dirname, '..');
const scriptPath = path.join(backendDir, 'scripts', 'db-size-report.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

function md5File(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

function makeSampleDb(filePath) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY);
    CREATE TABLE user_data (
      account_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE user_data_parts (
      account_id TEXT NOT NULL,
      part_key TEXT NOT NULL,
      data TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      PRIMARY KEY (account_id, part_key)
    );
    CREATE TABLE sync_events (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      action TEXT,
      payload TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  ensureVersionSnapshotSchema(db);
  db.prepare('INSERT INTO accounts(id) VALUES (?)').run('acc-live-1');
  db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)').run('acc-live-1', '{"todos":[]}');
  db.prepare('INSERT INTO user_data_parts(account_id,part_key,data,data_hash) VALUES (?,?,?,?)')
    .run('acc-live-1', 'todos', JSON.stringify([{ id: 1, title: 'x'.repeat(200) }]), 'h1');
  db.prepare('INSERT INTO user_data(account_id,data) VALUES (?,?)').run('orphan-acc', '{"todos":[]}');
  db.prepare(
    'INSERT INTO user_data_versions(account_id,data,created_at) VALUES (?,?,?)'
  ).run('acc-live-1', '{"a":1}', '2026-01-01T00:00:00.000Z');
  db.prepare(
    'INSERT INTO user_data_versions(account_id,data,created_at) VALUES (?,?,?)'
  ).run('acc-live-1', '{"a":2}', '2026-01-02T00:00:00.000Z');
  db.close();
}

test('db-size-report script is read-only and prints core sections', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-db-size-'));
  const dbPath = path.join(dir, 'sample.db');
  makeSampleDb(dbPath);

  const before = md5File(dbPath);
  const out = execFileSync(process.execPath, [scriptPath, `--db=${dbPath}`], {
    cwd: backendDir,
    encoding: 'utf8',
  });
  const after = md5File(dbPath);

  assert.equal(before, after, 'database file md5 must be unchanged');
  assert.match(out, /گزارش حجم پایگاه داده/);
  assert.match(out, /PRAGMA/);
  assert.match(out, /حجم اشیاء/);
  assert.match(out, /جمع‌بندی/);
  assert.match(out, /user_data/);
});

test('buildDbSizeReport on sample db returns expected structure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-db-size-api-'));
  const dbPath = path.join(dir, 'sample.db');
  makeSampleDb(dbPath);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const report = buildDbSizeReport(db, dbPath);
  db.close();
  assert.ok(report.files.database.bytes > 0);
  assert.ok(report.pragmas.page_size > 0);
  assert.ok(report.dbstat.top20.length > 0);
  assert.ok(report.history_tables.some(t => t.table === 'user_data' && t.present));
  assert.ok(report.version_retention.present);
  assert.equal(report.summary_lines.length, 5);
});

test('db-size-report script source has no mutating SQL or file removal', () => {
  const forbidden = [/\bDELETE\b/, /\bUPDATE\b/, /\bINSERT\b/, /\bVACUUM\b/, /\bDROP\b/, /\bunlink\b/];
  for (const re of forbidden) {
    assert.doesNotMatch(scriptSource, re, `forbidden pattern ${re}`);
  }
  assert.match(scriptSource, /readonly:\s*true/);
  assert.match(scriptSource, /fileMustExist:\s*true/);
});