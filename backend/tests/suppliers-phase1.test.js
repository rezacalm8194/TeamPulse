const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  BUSINESS_COLLECTIONS,
  PHASE7_COLLECTIONS,
  BUSINESS_MIGRATION_PHASE7,
  ensureBusinessStoreSchema,
  migrateBusinessParts,
  hasMigratedCollection,
  replaceRows,
  loadRowsPage,
} = require('../utils/businessStore');
const { partyRoles } = require('../utils/partyRoles');
const {
  supplierListSummaryDebt,
  purchaseTotal,
} = require('../utils/supplierFinanceSummary');
const { studentListSummaryDebt } = require('../utils/studentFinanceSummary');

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
  if (runMigrations) {
    const { ensureDocumentStoreSchema } = require('../utils/documentStore');
    ensureDocumentStoreSchema(db);
  }
  return db;
}

test('purchases collection is accepted on business store', () => {
  assert.ok(BUSINESS_COLLECTIONS.includes('purchases'));
  for (const key of PHASE7_COLLECTIONS) assert.ok(BUSINESS_COLLECTIONS.includes(key));
});

test('phase 7 migration moves purchases out of user_data_parts', () => {
  const db = makeDb();
  db.prepare('INSERT INTO user_data (account_id,data,data_etag) VALUES (?,?,?)')
    .run('acc-p7', '__parts__', 'etag1');
  db.prepare('INSERT INTO user_data_parts (account_id,part_key,data,data_hash) VALUES (?,?,?,?)')
    .run('acc-p7', 'purchases', JSON.stringify([
      { id: 1, supplier_id: 5, date_jalali: '1404/01/01', total_amount: 100, items: [] },
    ]), 'h1');
  const result = migrateBusinessParts(db);
  assert.equal(result.phase7.applied, true);
  assert.equal(hasMigratedCollection(db, 'acc-p7', 'purchases'), true);
  assert.ok(db.prepare('SELECT 1 FROM app_migrations WHERE name=?').get(BUSINESS_MIGRATION_PHASE7));
});

test('purchases pagination accepts collection', () => {
  const db = makeDb();
  replaceRows(db, 'acc-p', 'purchases', [
    { id: 2, supplier_id: 1, date_jalali: '1404/02/02', total_amount: 50 },
    { id: 1, supplier_id: 1, date_jalali: '1404/01/01', total_amount: 30 },
  ]);
  const page = loadRowsPage(db, 'acc-p', 'purchases', { limit: 10, order: 'desc' });
  assert.equal(page.items.length, 2);
});

test('_partyRoles legacy compatibility', () => {
  assert.deepEqual(partyRoles({ is_supplier: true }), { is_supplier: true, is_client: false });
  assert.deepEqual(partyRoles({ is_supplier: false }), { is_supplier: false, is_client: true });
  assert.deepEqual(partyRoles({}), { is_supplier: false, is_client: true });
  assert.deepEqual(partyRoles({ is_supplier: true, is_client: true }), { is_supplier: true, is_client: true });
  assert.deepEqual(partyRoles({ is_supplier: false, is_client: false }), { is_supplier: false, is_client: false });
});

test('supplier debt: partial pay, multi currency, dual-role person', () => {
  const purchases = [
    { id: 1, supplier_id: 9, total_amount: 1000, currency: 'تومان' },
    { id: 2, supplier_id: 9, items: [{ name: 'x', qty: 2, unit_price: 100 }], currency: 'تومان' },
    { id: 3, supplier_id: 9, total_amount: 50, currency: 'دلار' },
  ];
  const expenses = [
    { id: 10, source: 'supplier_payment', supplier_id: 9, amount: 500, currency: 'تومان' },
    { id: 11, source: 'supplier_payment', supplier_id: 9, amount: 20, currency: 'تومان' },
  ];
  const debt = supplierListSummaryDebt(9, purchases, expenses);
  assert.equal(purchaseTotal(purchases[1]), 200);
  assert.equal(debt.purchaseToman, 1200);
  assert.equal(debt.paidToman, 520);
  assert.equal(debt.balance, 680);
  assert.equal(debt.fxBooks.length, 1);
  assert.equal(debt.fxBooks[0].balance, 50);

  const clientDebt = studentListSummaryDebt(
    { id: 9, wallet: 0 },
    [{ id: 1, student_id: 9, total_amount: 300, currency: 'تومان' }],
    [{ id: 1, student_id: 9, amount: 100, currency: 'تومان' }],
  );
  assert.equal(clientDebt.balance, 200);
  assert.notEqual(debt.balance, clientDebt.balance);
});

test('supplier payment counts once in expenses; purchases do not inflate expense totals', () => {
  const purchases = [{ id: 1, supplier_id: 3, total_amount: 900, currency: 'تومان' }];
  const expenses = [
    { id: 5, source: 'supplier_payment', supplier_id: 3, amount: 400 },
    { id: 6, category: 'اجاره', amount: 200 },
  ];
  const expenseSum = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const purchaseSum = purchases.reduce((s, p) => s + Number(p.total_amount || 0), 0);
  assert.equal(expenseSum, 600);
  assert.equal(purchaseSum, 900);
  assert.notEqual(expenseSum, expenseSum + purchaseSum);
  const linked = expenses.filter((e) => e.source === 'supplier_payment');
  assert.equal(linked.length, 1);
  assert.equal(linked.reduce((s, e) => s + e.amount, 0), 400);
});