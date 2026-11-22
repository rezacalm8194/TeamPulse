const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const {
  runCompact,
  readDbPragmas,
  tableRowCounts,
  pickSampleRow,
  sampleRowStillMatches,
} = require('../scripts/db-compact');
const { runIncrementalVacuumPass } = require('../utils/dbIncrementalVacuum');

const backendDir = path.resolve(__dirname, '..');
const scriptPath = path.join(backendDir, 'scripts', 'db-compact.js');

function md5File(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

function makeBloatedDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT, payload TEXT);
    CREATE TABLE user_data (account_id TEXT PRIMARY KEY, data TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id));
  `);
  db.prepare('INSERT INTO accounts (id, email, payload) VALUES (?,?,?)')
    .run('acc-1', 'one@test.com', 'seed-row-keep');
  db.prepare('INSERT INTO user_data (account_id, data) VALUES (?,?)')
    .run('acc-1', '{"ok":true}');
  db.exec(`
    CREATE TABLE aaa_probe (label TEXT, n INTEGER PRIMARY KEY);
    INSERT INTO aaa_probe (label, n) VALUES ('same', 1), ('same', 2);
  `);
  const blob = 'B'.repeat(80_000);
  const insert = db.prepare('INSERT INTO accounts (id, email, payload) VALUES (?,?,?)');
  const tx = db.transaction(() => {
    for (let i = 0; i < 600; i++) {
      insert.run(`tmp-${i}`, `t${i}@test.com`, blob);
    }
  });
  tx();
  db.exec("DELETE FROM accounts WHERE id LIKE 'tmp-%'");
  const before = readDbPragmas(db);
  const sizeBefore = fs.statSync(dbPath).size;
  db.close();
  return {
    freelist_before: before.freelist_count,
    page_count_before: before.page_count,
    size_before: sizeBefore,
  };
}

test('dry run without --yes does not modify the database file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-db-compact-dry-'));
  const dbPath = path.join(dir, 'sample.db');
  makeBloatedDb(dbPath);
  const before = md5File(dbPath);
  const out = execFileSync(process.execPath, [scriptPath, `--db=${dbPath}`], {
    cwd: backendDir,
    encoding: 'utf8',
  });
  const after = md5File(dbPath);
  assert.equal(before, after);
  assert.match(out, /فقط با --yes/);
  assert.match(out, /freelist/);
  assert.match(out, /× 3 \+ WAL \+ 200MB/);
});

test('--yes compacts, keeps row counts, writes pre-compact backup with ok integrity', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-db-compact-yes-'));
  const dbPath = path.join(dir, 'sample.db');
  const bloat = makeBloatedDb(dbPath);
  const countsBefore = (() => {
    const db = new Database(dbPath, { readonly: true });
    const c = tableRowCounts(db);
    db.close();
    return c;
  })();

  const result = await runCompact({ yes: true, db: dbPath });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(result.backupPath));
  assert.match(result.backupPath, /pre-compact-.*\.db$/);

  const backupSize = fs.statSync(result.backupPath).size;
  assert.ok(backupSize < bloat.size_before, 'VACUUM INTO backup should be smaller than bloated main file');

  const backupDb = new Database(result.backupPath, { readonly: true });
  assert.equal(backupDb.pragma('integrity_check', { simple: true }), 'ok');
  backupDb.close();

  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(Number(db.pragma('auto_vacuum', { simple: true })), 2);
  assert.deepEqual(tableRowCounts(db), countsBefore);
  const row = db.prepare('SELECT payload FROM accounts WHERE id=?').get('acc-1');
  assert.equal(row.payload, 'seed-row-keep');
  const afterPragmas = readDbPragmas(db);
  db.close();

  assert.ok(afterPragmas.freelist_count < bloat.freelist_before);
  const shrunk = result.file_after.file_bytes < bloat.size_before
    || afterPragmas.page_count < bloat.page_count_before;
  assert.ok(shrunk, 'expected smaller file or fewer pages after VACUUM');
});

test('compact aborts when another connection holds a write transaction', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-db-compact-lock-'));
  const dbPath = path.join(dir, 'locked.db');
  makeBloatedDb(dbPath);
  const before = md5File(dbPath);

  const holder = new Database(dbPath, { timeout: 60_000 });
  holder.pragma('journal_mode = WAL');
  holder.prepare('BEGIN IMMEDIATE').run();

  const child = spawnSync(process.execPath, [scriptPath, '--yes', `--db=${dbPath}`], {
    cwd: backendDir,
    encoding: 'utf8',
    timeout: 30_000,
  });

  holder.prepare('ROLLBACK').run();
  holder.close();

  assert.notEqual(child.status, 0);
  assert.match(child.stdout + child.stderr, /متوقف|قفل|نوشتن/);
  assert.equal(md5File(dbPath), before);
  assert.equal(fs.readdirSync(dir).filter(n => n.startsWith('pre-compact-')).length, 0);
});

test('sample row check uses rowid, not the first column value', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE aaa_probe (label TEXT, n INTEGER PRIMARY KEY);
    INSERT INTO aaa_probe (label, n) VALUES ('same', 1), ('same', 2);
  `);
  const sample = pickSampleRow(db);
  assert.equal(sample.table, 'aaa_probe');
  assert.equal(sample.row.label, 'same');
  assert.ok(sample.rowid >= 1);
  assert.equal(sampleRowStillMatches(db, sample), true);
  db.close();
});

test('nightly incremental vacuum job no-ops when auto_vacuum is not incremental', () => {
  const db = new Database(':memory:');
  const logs = [];
  const logger = { info: (event, meta) => logs.push({ event, meta }) };
  const result = runIncrementalVacuumPass(db, { logger });
  assert.equal(result.skipped, true);
  assert.equal(result.auto_vacuum, 0);
  assert.ok(logs.some(entry => entry.event === 'incremental_vacuum_skipped'));
  db.close();
});