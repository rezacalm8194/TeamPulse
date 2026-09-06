const crypto = require('crypto');
const { workspaceStorageKey } = require('./teamAccessSchema');
const { upsertRows, loadAllRows, ensureBusinessStoreSchema } = require('./businessStore');
const { logger } = require('./logger');

const BALE_API_BASE = process.env.BALE_API_BASE || 'https://tapi.bale.ai';
const TEST_PROVIDER_TOKEN = 'WALLET-TEST-1111111111111111';

let baleFetchImpl = (...args) => fetch(...args);
let dbRef = null;

function setBaleFetch(fn) {
  baleFetchImpl = typeof fn === 'function' ? fn : (...args) => fetch(...args);
}

function setBaleDb(nextDb) {
  dbRef = nextDb || null;
}

function activeDb() {
  if (!dbRef) dbRef = require('../config/database');
  return dbRef;
}

function ensureBaleSchema(db = activeDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bale_workspace_credentials (
      owner_account_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      bot_token TEXT NOT NULL,
      provider_token TEXT NOT NULL,
      bot_username TEXT,
      bot_id TEXT,
      webhook_registered INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (owner_account_id, workspace_id)
    );
    CREATE TABLE IF NOT EXISTS bale_payment_requests (
      id TEXT PRIMARY KEY,
      owner_account_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      student_id TEXT,
      reminder_id TEXT,
      package_id TEXT,
      amount_toman INTEGER NOT NULL,
      amount_rial INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      bale_invoice_ref TEXT,
      provider_charge_id TEXT,
      telegram_payment_charge_id TEXT,
      payment_row_id TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bale_pay_owner_ws
      ON bale_payment_requests(owner_account_id, workspace_id, status, created_at);
  `);
}

function tomanToRial(toman) {
  const n = Math.round(Number(toman));
  if (!Number.isFinite(n) || n < 1) return null;
  return n * 10;
}

function rialToToman(rial) {
  const n = Math.round(Number(rial));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / 10);
}

function maskSecret(value) {
  const s = String(value || '');
  if (s.length <= 8) return s ? '••••' : '';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

function getCredentials(ownerAccountId, workspaceId) {
  ensureBaleSchema();
  return activeDb().prepare(`
    SELECT * FROM bale_workspace_credentials
    WHERE owner_account_id=? AND workspace_id=?
  `).get(ownerAccountId, workspaceId) || null;
}

function credentialsPublicView(row) {
  if (!row) return { connected: false };
  return {
    connected: true,
    bot_username: row.bot_username || null,
    bot_id: row.bot_id || null,
    provider_token_hint: maskSecret(row.provider_token),
    bot_token_hint: maskSecret(row.bot_token),
    webhook_registered: !!row.webhook_registered,
    test_mode: row.provider_token === TEST_PROVIDER_TOKEN,
    updated_at: row.updated_at,
  };
}

async function baleApi(botToken, method, body = {}) {
  const url = `${BALE_API_BASE}/bot${botToken}/${method}`;
  const res = await baleFetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('bale_invalid_json');
  }
  if (!res.ok || !data || data.ok === false) {
    const err = new Error(data?.description || data?.error || `bale_${method}_failed`);
    err.bale = data;
    err.status = res.status;
    throw err;
  }
  return data.result;
}

function newPaymentRequestId() {
  return 'bp_' + crypto.randomBytes(8).toString('hex');
}

function nextPaymentRowId(storageKey) {
  ensureBusinessStoreSchema(activeDb());
  const rows = loadAllRows(activeDb(), storageKey, 'payments');
  let max = Date.now() % 1000000000;
  rows.forEach(row => {
    const n = Number(row?.id);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max + 1;
}

function todayJalaliApprox() {
  return new Date().toISOString().slice(0, 10);
}

function settlePaymentRequest(request, successfulPayment) {
  if (!request || request.status === 'paid') return request;
  const storageKey = workspaceStorageKey(request.owner_account_id, request.workspace_id);
  const paymentId = nextPaymentRowId(storageKey);
  const now = new Date().toISOString();
  const amountToman = rialToToman(successfulPayment?.total_amount) || request.amount_toman;
  const paymentRow = {
    id: paymentId,
    student_id: request.student_id != null ? Number(request.student_id) || request.student_id : null,
    package_id: request.package_id != null && request.package_id !== ''
      ? (Number(request.package_id) || request.package_id)
      : null,
    amount: amountToman,
    currency: 'تومان',
    date_jalali: todayJalaliApprox(),
    method: 'بله‌پی',
    account_id: null,
    note: `پرداخت بله‌پی · ${request.id}${successfulPayment?.provider_payment_charge_id ? ' · پیگیری ' + successfulPayment.provider_payment_charge_id : ''}`,
    source: 'bale_pay',
    bale_request_id: request.id,
    created_at: now,
    updated_at: now,
  };
  upsertRows(activeDb(), storageKey, 'payments', [paymentRow]);

  if (request.reminder_id) {
    try {
      const reminders = loadAllRows(activeDb(), storageKey, 'reminders');
      const rem = reminders.find(r => String(r.id) === String(request.reminder_id));
      if (rem && !rem.done) {
        const repeatMonths = Number(rem.repeat_months || 0);
        if (repeatMonths > 0) {
          rem.notified_levels = [];
          rem.updated_at = now;
          rem.note = `${rem.note || ''} · بله‌پی ${request.id}`.trim();
        } else {
          rem.done = true;
          rem.updated_at = now;
        }
        upsertRows(activeDb(), storageKey, 'reminders', [rem]);
      }
    } catch (e) {
      logger.warn('bale_reminder_settle_failed', { error: e.message, requestId: request.id });
    }
  }

  activeDb().prepare(`
    UPDATE bale_payment_requests SET
      status='paid',
      provider_charge_id=?,
      telegram_payment_charge_id=?,
      payment_row_id=?,
      paid_at=?,
      updated_at=?
    WHERE id=?
  `).run(
    String(successfulPayment?.provider_payment_charge_id || ''),
    String(successfulPayment?.telegram_payment_charge_id || ''),
    String(paymentId),
    now,
    now,
    request.id
  );

  return activeDb().prepare('SELECT * FROM bale_payment_requests WHERE id=?').get(request.id);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPayPageHtml(request, baseUrl) {
  const amount = Number(request.amount_toman || 0).toLocaleString('fa-IR');
  const ref = escapeHtml(request.bale_invoice_ref || '');
  const title = escapeHtml(request.title || 'درخواست پرداخت');
  const desc = escapeHtml(request.description || '');
  const status = request.status === 'paid' ? 'پرداخت‌شده' : 'در انتظار پرداخت';
  const openHint = request.bale_invoice_ref
    ? `<p class="hint">اگر داخل بله هستید، شناسه فاکتور را در بازو باز کنید یا از لینک مستقیم بله استفاده کنید.</p>
       <div class="ref" dir="ltr">${ref}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:Tahoma,Arial,sans-serif;background:#f4f5f8;margin:0;padding:28px 16px;color:#1f2937}
.card{max-width:420px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 8px 28px rgba(15,23,42,.08)}
h1{font-size:18px;margin:0 0 8px}
.amount{font-size:28px;font-weight:800;margin:16px 0;color:#111827}
.muted{color:#6b7280;font-size:12px;line-height:1.8}
.badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#eef2ff;color:#4338ca;font-size:11px}
.hint{margin-top:18px;font-size:12px;color:#4b5563;line-height:1.8}
.ref{margin-top:10px;padding:10px;border:1px dashed #c7d2fe;border-radius:8px;font-size:12px;word-break:break-all;background:#f8fafc}
a.home{display:inline-block;margin-top:18px;color:#7c6af7;font-size:12px}
</style>
</head>
<body>
<div class="card">
  <div class="badge">${escapeHtml(status)}</div>
  <h1>${title}</h1>
  <div class="muted">${desc}</div>
  <div class="amount">${amount} تومان</div>
  <div class="muted">پرداخت از طریق کیف پول بله (بله‌پی). پس از پرداخت موفق، دریافت در TeamPulse ثبت می‌شود.</div>
  ${openHint}
  <a class="home" href="${escapeHtml(baseUrl)}/app">بازگشت به TeamPulse</a>
</div>
</body></html>`;
}

function publicBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

async function handleWebhookUpdate(ownerAccountId, workspaceId, update) {
  ensureBaleSchema();
  const creds = getCredentials(ownerAccountId, workspaceId);
  if (!creds) return { handled: false };

  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    const payload = String(q.invoice_payload || '');
    const request = activeDb().prepare('SELECT * FROM bale_payment_requests WHERE id=?').get(payload);
    const ok = !!(request && request.status === 'pending'
      && request.owner_account_id === ownerAccountId
      && request.workspace_id === workspaceId
      && Number(q.total_amount) === Number(request.amount_rial));
    try {
      await baleApi(creds.bot_token, 'answerPreCheckoutQuery', {
        pre_checkout_query_id: q.id,
        ok,
        ...(ok ? {} : { error_message: 'این درخواست پرداخت معتبر نیست یا منقضی شده است' }),
      });
    } catch (e) {
      logger.warn('bale_precheckout_answer_failed', { error: e.message, payload });
    }
    return { handled: true, kind: 'pre_checkout', ok };
  }

  const message = update.message || update.edited_message;
  const successful = message?.successful_payment;
  if (successful) {
    const payload = String(successful.invoice_payload || '');
    const request = activeDb().prepare('SELECT * FROM bale_payment_requests WHERE id=?').get(payload);
    if (request
      && request.status === 'pending'
      && request.owner_account_id === ownerAccountId
      && request.workspace_id === workspaceId) {
      settlePaymentRequest(request, successful);
      return { handled: true, kind: 'successful_payment', id: payload };
    }
  }
  return { handled: true, kind: 'other' };
}

module.exports = {
  BALE_API_BASE,
  TEST_PROVIDER_TOKEN,
  setBaleFetch,
  setBaleDb,
  activeDb,
  ensureBaleSchema,
  tomanToRial,
  rialToToman,
  getCredentials,
  credentialsPublicView,
  baleApi,
  newPaymentRequestId,
  settlePaymentRequest,
  buildPayPageHtml,
  publicBaseUrl,
  escapeHtml,
  handleWebhookUpdate,
};
