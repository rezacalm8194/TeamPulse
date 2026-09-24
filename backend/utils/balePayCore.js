const crypto = require('crypto');
const { workspaceStorageKey } = require('./teamAccessSchema');
const { upsertRows, loadAllRows, ensureBusinessStoreSchema } = require('./businessStore');
const { logger } = require('./logger');
const { canEncryptSecrets, encryptSecret, decryptSecret, isEncryptedSecret } = require('./secretBox');

const BALE_API_BASE = process.env.BALE_API_BASE || 'https://tapi.bale.ai';
const TEST_PROVIDER_TOKEN = 'WALLET-TEST-1111111111111111';
/** BotFather-style token: numeric bot id, colon, then a secret without path/query chars. */
const BALE_BOT_TOKEN_RE = /^\d{5,16}:[A-Za-z0-9_-]{8,128}$/;
const BALE_API_METHOD_RE = /^[A-Za-z][A-Za-z0-9]{1,63}$/;

function isValidBaleBotToken(botToken) {
  return BALE_BOT_TOKEN_RE.test(String(botToken || ''));
}

function isValidBaleApiMethod(method) {
  return BALE_API_METHOD_RE.test(String(method || ''));
}

const BALE_API_TIMEOUT_MS = Number(process.env.BALE_API_TIMEOUT_MS) || 8000;
const BALE_API_MAX_INFLIGHT = Math.max(1, Number(process.env.BALE_API_MAX_INFLIGHT) || 2);
const BALE_GETME_CACHE_MS = Number(process.env.BALE_GETME_CACHE_MS) || 10 * 60 * 1000;
const BALE_GETME_NEG_CACHE_MS = 15 * 1000;

let baleFetchImpl = (...args) => fetch(...args);
let dbRef = null;
let baleTimeoutMs = BALE_API_TIMEOUT_MS;
let baleMaxInflight = BALE_API_MAX_INFLIGHT;
let getMeTtlMs = BALE_GETME_CACHE_MS;
const getMeCache = new Map();
const getMeInflight = new Map();
let baleInflight = 0;
const baleWaiters = [];

function tokenCacheKey(botToken) {
  return crypto.createHash('sha256').update(String(botToken || '')).digest('hex').slice(0, 32);
}

function resetBaleRuntime() {
  getMeCache.clear();
  getMeInflight.clear();
}

function setBaleFetch(fn) {
  baleFetchImpl = typeof fn === 'function' ? fn : (...args) => fetch(...args);
  resetBaleRuntime();
}

function setBaleApiOptions(opts = {}) {
  if (opts.timeoutMs != null) baleTimeoutMs = Number(opts.timeoutMs) || BALE_API_TIMEOUT_MS;
  if (opts.maxInflight != null) baleMaxInflight = Math.max(1, Number(opts.maxInflight) || 1);
  if (opts.getMeTtlMs != null) getMeTtlMs = Number(opts.getMeTtlMs);
  if (opts.reset) resetBaleRuntime();
}

function enqueueBaleCall(task) {
  return new Promise((resolve, reject) => {
    const start = () => {
      baleInflight += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          baleInflight -= 1;
          const next = baleWaiters.shift();
          if (next) next();
        });
    };
    if (baleInflight < baleMaxInflight) start();
    else baleWaiters.push(start);
  });
}

async function fetchBaleWithTimeout(url, init) {
  const timeoutMs = baleTimeoutMs;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  try {
    const pending = baleFetchImpl(url, ctrl ? { ...init, signal: ctrl.signal } : init);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { ctrl?.abort(); } catch (_) { /* ignore */ }
        const err = new Error('bale_timeout');
        err.code = 'BALE_TIMEOUT';
        reject(err);
      }, timeoutMs);
    });
    return await Promise.race([pending, timeout]);
  } catch (e) {
    if (e && (e.code === 'BALE_TIMEOUT' || e.message === 'bale_timeout' || e.name === 'AbortError')) {
      const err = new Error('bale_timeout');
      err.code = 'BALE_TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
      webhook_secret TEXT,
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
  const credCols = db.prepare('PRAGMA table_info(bale_workspace_credentials)').all().map((c) => c.name);
  if (credCols.length && !credCols.includes('webhook_secret')) {
    db.exec('ALTER TABLE bale_workspace_credentials ADD COLUMN webhook_secret TEXT');
  }
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

const WEBHOOK_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';
const WEBHOOK_SECRET_HEADER_BALE = 'X-Bale-Bot-Api-Secret-Token';
const WEBHOOK_SECRET_RE = /^[A-Za-z0-9_-]{32,256}$/;

function newWebhookSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function timingSafeEqualText(expected, provided) {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(provided || ''), 'utf8');
  if (!a.length) return false;
  const compare = Buffer.alloc(a.length);
  b.copy(compare, 0, 0, Math.min(b.length, a.length));
  const lengthOk = a.length === b.length;
  const contentOk = crypto.timingSafeEqual(a, compare);
  return lengthOk && contentOk;
}

function webhookSecretFromRequest(req) {
  const header = req?.get?.bind(req);
  return String(
    (header && (header(WEBHOOK_SECRET_HEADER) || header(WEBHOOK_SECRET_HEADER_BALE)))
    || req?.headers?.[WEBHOOK_SECRET_HEADER.toLowerCase()]
    || req?.headers?.[WEBHOOK_SECRET_HEADER_BALE.toLowerCase()]
    || ''
  );
}

function verifyWebhookSecret(expected, provided) {
  const secret = String(expected || '');
  if (!WEBHOOK_SECRET_RE.test(secret)) return false;
  return timingSafeEqualText(secret, provided);
}

function storeWebhookSecretValue(value) {
  return canEncryptSecrets() ? encryptSecret(value) : value;
}

function persistWebhookSecret(ownerAccountId, workspaceId, secret) {
  ensureBaleSchema();
  activeDb().prepare(`
    UPDATE bale_workspace_credentials
    SET webhook_secret=?, updated_at=datetime('now')
    WHERE owner_account_id=? AND workspace_id=?
  `).run(storeWebhookSecretValue(secret), ownerAccountId, workspaceId);
}

function issueWebhookSecret(ownerAccountId, workspaceId) {
  const secret = newWebhookSecret();
  persistWebhookSecret(ownerAccountId, workspaceId, secret);
  return secret;
}

function platformWebhookSecret() {
  const fromEnv = String(process.env.BALE_PLATFORM_WEBHOOK_SECRET || '').trim();
  if (WEBHOOK_SECRET_RE.test(fromEnv)) return fromEnv;
  const seed = String(process.env.TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || '').trim();
  if (!seed) return '';
  return crypto.createHmac('sha256', seed).update('teampulse-bale-platform-webhook-v1').digest('base64url');
}

function authorizeBaleWebhook(req, ownerAccountId, workspaceId) {
  const creds = getCredentials(ownerAccountId, workspaceId);
  if (!creds) return false;
  return verifyWebhookSecret(creds.webhook_secret, webhookSecretFromRequest(req));
}

function sealCredentialRow(row) {
  if (!row) return null;
  const botToken = decryptSecret(row.bot_token);
  const providerToken = decryptSecret(row.provider_token);
  const webhookSecret = decryptSecret(row.webhook_secret);
  const needsSeal = canEncryptSecrets() && (
    !isEncryptedSecret(row.bot_token)
    || !isEncryptedSecret(row.provider_token)
    || (row.webhook_secret && !isEncryptedSecret(row.webhook_secret))
  );
  if (needsSeal) {
    try {
      activeDb().prepare(`
        UPDATE bale_workspace_credentials
        SET bot_token=?, provider_token=?, webhook_secret=?
        WHERE owner_account_id=? AND workspace_id=?
      `).run(
        encryptSecret(botToken),
        encryptSecret(providerToken),
        row.webhook_secret ? encryptSecret(webhookSecret) : row.webhook_secret,
        row.owner_account_id,
        row.workspace_id
      );
    } catch (e) {
      logger.warn('bale_credential_seal_failed', { error: e.message });
    }
  }
  return { ...row, bot_token: botToken, provider_token: providerToken, webhook_secret: webhookSecret };
}

function getCredentials(ownerAccountId, workspaceId) {
  ensureBaleSchema();
  const row = activeDb().prepare(`
    SELECT * FROM bale_workspace_credentials
    WHERE owner_account_id=? AND workspace_id=?
  `).get(ownerAccountId, workspaceId);
  return sealCredentialRow(row);
}

function persistCredentials({
  ownerAccountId,
  workspaceId,
  botToken,
  providerToken,
  botUsername,
  botId,
}) {
  ensureBaleSchema();
  const storedBot = canEncryptSecrets() ? encryptSecret(botToken) : botToken;
  const storedProvider = canEncryptSecrets() ? encryptSecret(providerToken) : providerToken;
  activeDb().prepare(`
    INSERT INTO bale_workspace_credentials
      (owner_account_id, workspace_id, bot_token, provider_token, bot_username, bot_id, webhook_registered, updated_at)
    VALUES (?,?,?,?,?,?,0,datetime('now'))
    ON CONFLICT(owner_account_id, workspace_id) DO UPDATE SET
      bot_token=excluded.bot_token,
      provider_token=excluded.provider_token,
      bot_username=excluded.bot_username,
      bot_id=excluded.bot_id,
      webhook_registered=0,
      updated_at=datetime('now')
  `).run(ownerAccountId, workspaceId, storedBot, storedProvider, botUsername, botId);
  return getCredentials(ownerAccountId, workspaceId);
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

async function baleApiRaw(botToken, method, body = {}) {
  const url = `${BALE_API_BASE}/bot${botToken}/${method}`;
  const res = await fetchBaleWithTimeout(url, {
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

async function cachedGetMe(botToken) {
  const key = tokenCacheKey(botToken);
  const now = Date.now();
  const hit = getMeCache.get(key);
  if (hit && hit.until > now) {
    if (hit.error) throw hit.error;
    return hit.value;
  }
  const pending = getMeInflight.get(key);
  if (pending) return pending;

  const request = enqueueBaleCall(() => baleApiRaw(botToken, 'getMe', {}))
    .then((value) => {
      getMeCache.set(key, { until: Date.now() + getMeTtlMs, value });
      return value;
    })
    .catch((error) => {
      getMeCache.set(key, { until: Date.now() + BALE_GETME_NEG_CACHE_MS, error });
      throw error;
    })
    .finally(() => {
      getMeInflight.delete(key);
    });
  getMeInflight.set(key, request);
  return request;
}

async function baleApi(botToken, method, body = {}) {
  if (!isValidBaleBotToken(botToken)) {
    throw new Error('invalid_bot_token');
  }
  if (!isValidBaleApiMethod(method)) {
    throw new Error('invalid_bale_method');
  }
  if (method === 'getMe') {
    return cachedGetMe(botToken);
  }
  return enqueueBaleCall(() => baleApiRaw(botToken, method, body));
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
  const envBase = String(process.env.PUBLIC_BASE_URL || process.env.APP_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (envBase) {
    // Bale setWebhook only accepts HTTPS URLs.
    return envBase.replace(/^http:\/\//i, 'https://');
  }

  // Do not trust Host / X-Forwarded-* for public URLs; require PUBLIC_BASE_URL in production.
  const host = String(req?.get?.('host') || req?.headers?.host || '')
    .split(',')[0]
    .trim();
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return '';
  const proto = String(req?.protocol || 'http').toLowerCase() === 'https' ? 'https' : 'http';
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
  isValidBaleBotToken,
  isValidBaleApiMethod,
  setBaleFetch,
  setBaleApiOptions,
  resetBaleRuntime,
  setBaleDb,
  activeDb,
  ensureBaleSchema,
  tomanToRial,
  rialToToman,
  maskSecret,
  getCredentials,
  persistCredentials,
  credentialsPublicView,
  baleApi,
  newPaymentRequestId,
  settlePaymentRequest,
  buildPayPageHtml,
  publicBaseUrl,
  escapeHtml,
  handleWebhookUpdate,
  WEBHOOK_SECRET_HEADER,
  WEBHOOK_SECRET_HEADER_BALE,
  newWebhookSecret,
  webhookSecretFromRequest,
  verifyWebhookSecret,
  issueWebhookSecret,
  persistWebhookSecret,
  platformWebhookSecret,
  authorizeBaleWebhook,
};
