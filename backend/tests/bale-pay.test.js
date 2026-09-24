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
  core.setBaleApiOptions({ timeoutMs: 8000, maxInflight: 2, getMeTtlMs: 10 * 60 * 1000, reset: true });
});

test('bale bot token rejects path-changing characters before fetch', async () => {
  assert.equal(core.isValidBaleBotToken('123456:ABC-TESTTOKEN'), true);
  assert.equal(core.isValidBaleBotToken('123456:ABC/getMe'), false);
  assert.equal(core.isValidBaleBotToken('123456:ABC?foo=1'), false);
  assert.equal(core.isValidBaleBotToken('123456:ABC#frag'), false);
  assert.equal(core.isValidBaleBotToken('short'), false);

  let fetched = false;
  core.setBaleFetch(async () => {
    fetched = true;
    return { ok: true, async json() { return { ok: true, result: {} }; } };
  });
  await assert.rejects(
    () => core.baleApi('123456:ABC/getMe', 'sendMessage', { text: 'x' }),
    /invalid_bot_token/
  );
  await assert.rejects(
    () => core.baleApi('123456:ABC-TESTTOKEN', 'send/Message', {}),
    /invalid_bale_method/
  );
  assert.equal(fetched, false);

  const calls = [];
  core.setBaleFetch(async (url) => {
    calls.push(url);
    return { ok: true, async json() { return { ok: true, result: true }; } };
  });
  await core.baleApi('123456:ABC-TESTTOKEN', 'getMe', {});
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/bot123456:ABC-TESTTOKEN\/getMe$/);
  assert.equal(calls[0].includes('/bot123456:ABC/'), false);
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

test('webhook secret compare is constant-time and rejects missing secrets', () => {
  const secret = core.newWebhookSecret();
  assert.match(secret, /^[A-Za-z0-9_-]{32,256}$/);
  assert.equal(core.verifyWebhookSecret(secret, secret), true);
  assert.equal(core.verifyWebhookSecret(secret, secret.slice(0, -1) + 'x'), false);
  assert.equal(core.verifyWebhookSecret(secret, ''), false);
  assert.equal(core.verifyWebhookSecret('', secret), false);
  assert.equal(core.verifyWebhookSecret('short', 'short'), false);
  assert.equal(
    core.webhookSecretFromRequest({
      get: (name) => (name === core.WEBHOOK_SECRET_HEADER ? secret : ''),
      headers: {},
    }),
    secret
  );
});

test('issueWebhookSecret stores a sealed token used by authorizeBaleWebhook', () => {
  const db = makeTestDb();
  const owner = 'acc_sec';
  db.prepare(`
    INSERT INTO bale_workspace_credentials
      (owner_account_id, workspace_id, bot_token, provider_token, bot_username, webhook_registered)
    VALUES (?,?,?,?,?,0)
  `).run(owner, 'default', '123456:ABC-TESTTOKEN', core.TEST_PROVIDER_TOKEN, 'tp_bot');
  const secret = core.issueWebhookSecret(owner, 'default');
  const creds = core.getCredentials(owner, 'default');
  assert.equal(creds.webhook_secret, secret);
  const raw = db.prepare(
    'SELECT webhook_secret FROM bale_workspace_credentials WHERE owner_account_id=?'
  ).get(owner);
  if (process.env.JWT_SECRET || process.env.TOKEN_ENCRYPTION_KEY) {
    assert.notEqual(raw.webhook_secret, secret);
  }
  assert.equal(core.authorizeBaleWebhook({
    get: (name) => (name === core.WEBHOOK_SECRET_HEADER ? secret : ''),
    headers: {},
  }, owner, 'default'), true);
  assert.equal(core.authorizeBaleWebhook({
    get: () => '',
    headers: {},
  }, owner, 'default'), false);
  assert.equal(core.authorizeBaleWebhook({
    get: (name) => (name === core.WEBHOOK_SECRET_HEADER ? 'wrong-token-wrong-token-wrong-token-xx' : ''),
    headers: {},
  }, owner, 'default'), false);
});

test('forged successful_payment is ignored without webhook secret header', async () => {
  const db = makeTestDb();
  const owner = 'acc_http';
  const id = 'bp_cccccccccccccccc';
  const secret = core.newWebhookSecret();
  db.prepare(`
    INSERT INTO bale_workspace_credentials
      (owner_account_id, workspace_id, bot_token, provider_token, bot_username, webhook_registered, webhook_secret)
    VALUES (?,?,?,?,?,1,?)
  `).run(owner, 'default', '123456:ABC-TESTTOKEN', core.TEST_PROVIDER_TOKEN, 'tp_bot', secret);
  db.prepare(`
    INSERT INTO bale_payment_requests (
      id, owner_account_id, workspace_id, student_id, reminder_id, package_id,
      amount_toman, amount_rial, title, description, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?, 'pending')
  `).run(id, owner, 'default', '1', null, null, 5000, 50000, 'پرداخت', 'desc');

  const body = {
    message: {
      successful_payment: {
        invoice_payload: id,
        total_amount: 50000,
        provider_payment_charge_id: 'p-fake',
        telegram_payment_charge_id: 't-fake',
      },
    },
  };
  const forgedReq = { get: () => '', headers: {}, body };
  assert.equal(core.authorizeBaleWebhook(forgedReq, owner, 'default'), false);
  assert.equal(db.prepare('SELECT status FROM bale_payment_requests WHERE id=?').get(id).status, 'pending');

  const okReq = {
    get: (name) => (name === core.WEBHOOK_SECRET_HEADER ? secret : ''),
    headers: {},
    body,
  };
  assert.equal(core.authorizeBaleWebhook(okReq, owner, 'default'), true);
  const paid = await core.handleWebhookUpdate(owner, 'default', body);
  assert.equal(paid.kind, 'successful_payment');
  assert.equal(db.prepare('SELECT status FROM bale_payment_requests WHERE id=?').get(id).status, 'paid');
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

test('publicBaseUrl ignores Host unless PUBLIC_BASE_URL is set', () => {
  const prev = process.env.PUBLIC_BASE_URL;
  const prevApp = process.env.APP_URL;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_URL;
  assert.equal(
    core.publicBaseUrl({
      headers: { 'x-forwarded-proto': 'https', host: 'evil.example' },
      protocol: 'https',
      get: () => 'evil.example',
    }),
    ''
  );
  assert.equal(
    core.publicBaseUrl({
      headers: { host: 'localhost:3001' },
      protocol: 'http',
      get: () => 'localhost:3001',
    }),
    'http://localhost:3001'
  );
  process.env.PUBLIC_BASE_URL = 'http://teampulse.ir/';
  assert.equal(
    core.publicBaseUrl({
      headers: { host: 'evil.example' },
      get: () => 'evil.example',
    }),
    'https://teampulse.ir'
  );
  if (prev == null) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = prev;
  if (prevApp == null) delete process.env.APP_URL;
  else process.env.APP_URL = prevApp;
});

test('client hooks and asset version for Bale Pay exist', () => {
  const root = path.resolve(__dirname, '../..');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const version = app.match(/TP_ASSET_V = 'tp(\d+)'/)?.[1];
  assert.ok(version, 'TP_ASSET_V must be defined');
  assert.match(app, new RegExp('team-pulse-static-v' + version));
  assert.match(html, new RegExp('tp' + version));
  assert.match(sw, new RegExp('team-pulse-static-v' + version));
  assert.match(app, /function openBalePaymentRequest/);
  assert.match(app, /function saveBalePayCredentials/);
  assert.match(app, /\/api\/bale\/payment-requests/);
  assert.match(app, /sharePartyTransactionsLink/);
  assert.match(fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8'), /\/api\/bale/);
  assert.match(fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8'), /baleInvoiceLimiter/);
  assert.match(fs.readFileSync(path.join(root, 'backend/routes/bale.js'), 'utf8'), /balePayCore/);
  assert.match(fs.readFileSync(path.join(root, 'backend/routes/bale.js'), 'utf8'), /secret_token/);
  assert.match(fs.readFileSync(path.join(root, 'backend/routes/bale.js'), 'utf8'), /authorizeBaleWebhook/);
});

test('getMe is cached and Bale calls time out instead of hanging the request', async () => {
  const token = '123456:ABC-TESTTOKEN';
  let calls = 0;
  core.setBaleFetch(async () => {
    calls += 1;
    return { ok: true, async json() { return { ok: true, result: { id: 1, username: 'tp_bot' } }; } };
  });
  const first = await core.baleApi(token, 'getMe', {});
  const second = await core.baleApi(token, 'getMe', {});
  assert.equal(first.username, 'tp_bot');
  assert.equal(second.username, 'tp_bot');
  assert.equal(calls, 1);

  core.setBaleApiOptions({ timeoutMs: 40, maxInflight: 2, reset: true });
  core.setBaleFetch(() => new Promise(() => {}));
  const started = Date.now();
  await assert.rejects(() => core.baleApi(token, 'createInvoiceLink', { title: 'x' }), /bale_timeout/);
  assert.ok(Date.now() - started < 400);
});

test('createInvoiceLink shares a bounded outbound queue', async () => {
  const token = '123456:ABC-TESTTOKEN';
  let current = 0;
  let max = 0;
  core.setBaleApiOptions({ timeoutMs: 2000, maxInflight: 1, reset: true });
  core.setBaleFetch(async () => {
    current += 1;
    max = Math.max(max, current);
    await new Promise(resolve => setTimeout(resolve, 50));
    current -= 1;
    return { ok: true, async json() { return { ok: true, result: 'https://pay.test/x' }; } };
  });
  await Promise.all([
    core.baleApi(token, 'createInvoiceLink', { title: 'a' }),
    core.baleApi(token, 'createInvoiceLink', { title: 'b' }),
    core.baleApi(token, 'createInvoiceLink', { title: 'c' }),
  ]);
  assert.equal(max, 1);
});
