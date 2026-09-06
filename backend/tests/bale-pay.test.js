const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const core = require('../utils/balePayCore');
const { loadAllRows, ensureBusinessStoreSchema } = require('../utils/businessStore');

function makeTestDb() {
  const db = new Database(':memory:');
  ensureBusinessStoreSchema(db);
  core.setBaleDb(db);
  core.ensureBaleSchema();
  return db;
}

test.afterEach(() => {
  core.setBaleDb(null);
  core.setBaleFetch(null);
});

test('toman and rial conversion for Bale Pay amounts', () => {
  assert.equal(core.tomanToRial(150000), 1500000);
  assert.equal(core.tomanToRial(0), null);
  assert.equal(core.rialToToman(1500000), 150000);
  assert.equal(core.TEST_PROVIDER_TOKEN, 'WALLET-TEST-1111111111111111');
});

test('payment request ids fit Bale payload limits', () => {
  const id = core.newPaymentRequestId();
  assert.match(id, /^bp_[a-f0-9]{16}$/);
  assert.ok(Buffer.byteLength(id, 'utf8') <= 128);
});

test('pay page html includes amount and bale branding', () => {
  const html = core.buildPayPageHtml({
    title: 'تسویه مانده',
    description: 'پرداخت آزمایشی',
    amount_toman: 250000,
    status: 'pending',
    bale_invoice_ref: 'inv-test-1',
  }, 'https://example.test');
  assert.match(html, /تسویه مانده/);
  assert.match(html, /بله‌پی/);
  assert.match(html, /inv-test-1/);
  assert.match(html, /https:\/\/example\.test\/app/);
});

test('successful payment settles into business payments store', () => {
  const db = makeTestDb();
  const id = 'bp_aaaaaaaaaaaaaaaa';
  db.prepare(`
    INSERT INTO bale_payment_requests (
      id, owner_account_id, workspace_id, student_id, reminder_id, package_id,
      amount_toman, amount_rial, title, description, status, bale_invoice_ref
    ) VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?)
  `).run(id, 'acc_test', 'default', '7', '3', '9', 10000, 100000, 'قسط', 'تست', 'ref');

  db.prepare(`
    INSERT INTO workspace_business_rows(
      storage_key,collection_key,row_id,payload,payload_hash,archived,date_key,search_text,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    'acc_test',
    'reminders',
    '3',
    JSON.stringify({ id: 3, student_id: 7, title: 'سررسید', amount: 10000, done: false, repeat_months: 0 }),
    'h1',
    0,
    14050101,
    'reminder',
    null
  );

  const settled = core.settlePaymentRequest(
    db.prepare('SELECT * FROM bale_payment_requests WHERE id=?').get(id),
    {
      total_amount: 100000,
      provider_payment_charge_id: 'trace-9',
      telegram_payment_charge_id: 'tg-1',
      invoice_payload: id,
    }
  );

  assert.equal(settled.status, 'paid');
  assert.equal(settled.provider_charge_id, 'trace-9');
  const payments = loadAllRows(db, 'acc_test', 'payments');
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amount, 10000);
  assert.equal(payments[0].method, 'بله‌پی');
  assert.equal(payments[0].source, 'bale_pay');
  const reminders = loadAllRows(db, 'acc_test', 'reminders');
  assert.equal(reminders[0].done, true);
});

test('webhook handler answers pre_checkout and settles successful_payment', async () => {
  const db = makeTestDb();
  const owner = 'acc_wh';
  const id = 'bp_bbbbbbbbbbbbbbbb';
  db.prepare(`
    INSERT INTO bale_workspace_credentials
      (owner_account_id, workspace_id, bot_token, provider_token, bot_username, webhook_registered)
    VALUES (?,?,?,?,?,1)
  `).run(owner, 'default', '123456:ABC-TESTTOKEN', core.TEST_PROVIDER_TOKEN, 'tp_bot');
  db.prepare(`
    INSERT INTO bale_payment_requests (
      id, owner_account_id, workspace_id, student_id, reminder_id, package_id,
      amount_toman, amount_rial, title, description, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?, 'pending')
  `).run(id, owner, 'default', '1', null, null, 5000, 50000, 'پرداخت', 'desc');

  const calls = [];
  core.setBaleFetch(async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      async json() { return { ok: true, result: true }; },
    };
  });

  const pre = await core.handleWebhookUpdate(owner, 'default', {
    pre_checkout_query: {
      id: 'pcq1',
      invoice_payload: id,
      total_amount: 50000,
      currency: 'IRR',
    },
  });
  assert.equal(pre.ok, true);
  assert.equal(calls[0].body.ok, true);
  assert.equal(calls[0].body.pre_checkout_query_id, 'pcq1');

  const paid = await core.handleWebhookUpdate(owner, 'default', {
    message: {
      successful_payment: {
        invoice_payload: id,
        total_amount: 50000,
        provider_payment_charge_id: 'p1',
        telegram_payment_charge_id: 't1',
      },
    },
  });
  assert.equal(paid.kind, 'successful_payment');
  const row = db.prepare('SELECT * FROM bale_payment_requests WHERE id=?').get(id);
  assert.equal(row.status, 'paid');
  assert.equal(loadAllRows(db, owner, 'payments').length, 1);
});

test('client hooks and asset version for Bale Pay exist', () => {
  const root = path.resolve(__dirname, '../..');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(app, /TP_ASSET_V = 'tp175'/);
  assert.match(app, /team-pulse-static-v175/);
  assert.match(html, /tp175/);
  assert.match(sw, /team-pulse-static-v175/);
  assert.match(app, /function openBalePaymentRequest/);
  assert.match(app, /function saveBalePayCredentials/);
  assert.match(app, /\/api\/bale\/payment-requests/);
  assert.match(app, /sharePartyTransactionsLink/);
  assert.match(fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8'), /\/api\/bale/);
  assert.match(fs.readFileSync(path.join(root, 'backend/routes/bale.js'), 'utf8'), /balePayCore/);
});
