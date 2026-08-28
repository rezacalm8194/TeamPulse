const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  BUSINESS_COLLECTIONS,
  PHASE6_COLLECTIONS,
  BUSINESS_MIGRATION_PHASE6,
  ensureBusinessStoreSchema,
  migrateBusinessParts,
  hasMigratedCollection,
  loadRowsPage,
  replaceRows,
} = require('../utils/businessStore');
const { ensureDocumentStoreSchema, writeWorkspaceDocument } = require('../utils/documentStore');

function makeDb({ runMigrations = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_data (
      account_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      data_etag TEXT,
      updated_at TEXT
    );
    CREATE TABLE user_data_parts (
      account_id TEXT NOT NULL,
      part_key TEXT NOT NULL,
      data TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY(account_id, part_key)
    );
  `);
  ensureBusinessStoreSchema(db);
  if (runMigrations) ensureDocumentStoreSchema(db);
  return db;
}

test('phase 6 migration moves packages and families out of user_data_parts', () => {
  const db = makeDb();
  db.prepare('INSERT INTO user_data (account_id,data,data_etag) VALUES (?,?,?)')
    .run('acc-phase6', '__parts__', 'etag1');
  const upsert = db.prepare(`
    INSERT INTO user_data_parts (account_id,part_key,data,data_hash) VALUES (?,?,?,?)
  `);
  upsert.run('acc-phase6', '__scalars__', '{}', 'h0');
  upsert.run('acc-phase6', 'packages', JSON.stringify([
    { id: 11, student_id: 1, total_amount: 100, start_date: '1404/01/01' },
  ]), 'h1');
  upsert.run('acc-phase6', 'families', JSON.stringify([{ id: 3, name: 'Group A' }]), 'h2');
  upsert.run('acc-phase6', 'reminders', JSON.stringify([
    { id: 5, student_id: 1, title: 'Pay', due_date_jalali: '1404/02/01' },
  ]), 'h3');

  const result = migrateBusinessParts(db);
  assert.equal(result.phase6.applied, true);
  assert.equal(hasMigratedCollection(db, 'acc-phase6', 'packages'), true);
  assert.equal(hasMigratedCollection(db, 'acc-phase6', 'families'), true);
  assert.equal(hasMigratedCollection(db, 'acc-phase6', 'reminders'), true);
  assert.equal(
    db.prepare("SELECT 1 FROM user_data_parts WHERE account_id=? AND part_key='packages'").get('acc-phase6'),
    undefined
  );
  assert.ok(db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(BUSINESS_MIGRATION_PHASE6));
});

test('business pagination returns stable pages for packages', () => {
  const db = makeDb();
  ensureBusinessStoreSchema(db);
  replaceRows(db, 'acc-page', 'packages', [
    { id: 1, student_id: 10, start_date: '1404/01/01', note: 'a' },
    { id: 2, student_id: 11, start_date: '1404/01/02', note: 'b' },
    { id: 3, student_id: 12, start_date: '1404/01/03', note: 'c' },
  ]);
  const first = loadRowsPage(db, 'acc-page', 'packages', { limit: 2 });
  assert.equal(first.items.length, 2);
  assert.ok(first.next_cursor);
  const second = loadRowsPage(db, 'acc-page', 'packages', { limit: 2, cursor: first.next_cursor });
  assert.equal(second.items.length, 1);
  assert.equal(second.next_cursor, null);
});

test('business collections include phase 6 keys', () => {
  for (const key of PHASE6_COLLECTIONS) assert.ok(BUSINESS_COLLECTIONS.includes(key));
});
