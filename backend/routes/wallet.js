const crypto = require('crypto');
const router = require('express').Router();
const db = require('../config/database');
const auth = require('../middleware/auth');
const baleCore = require('../utils/balePayCore');
const { decryptSecret } = require('../utils/secretBox');

const MIN_CHARGE_AMOUNT = 10000;
const MAX_CHARGE_AMOUNT = 10000000;

function ensureWalletTables() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_wallets (
      account_id TEXT PRIMARY KEY,
      balance REAL DEFAULT 0,
      daily_cost REAL DEFAULT 1000,
      gift_given INTEGER DEFAULT 0,
      last_charge_check INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS wallet_charge_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      amount REAL NOT NULL,
      receipt_text TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS wallet_bale_topups (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      amount_toman INTEGER NOT NULL,
      amount_rial INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      bale_invoice_ref TEXT NOT NULL DEFAULT '',
      provider_charge_id TEXT NOT NULL DEFAULT '',
      telegram_charge_id TEXT NOT NULL DEFAULT '',
      paid_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `).run();
}

function getAdminSettings() {
  try {
    const row = db.prepare("SELECT data FROM user_data WHERE account_id='__admin_settings__'").get();
    const parsed = row ? JSON.parse(row.data) : {};
    return {
      ...parsed,
      bale_bot_token: decryptSecret(parsed.bale_bot_token),
      bale_provider_token: decryptSecret(parsed.bale_provider_token),
    };
  } catch {
    return {};
  }
}

// توکن پلتفرم برای شارژ کیف پول: اول تنظیمات ادمین، بعد env، بعد حالت تست
function getPlatformBaleCreds() {
  const settings = getAdminSettings();
  const botToken = String(
    settings.bale_bot_token ||
    process.env.BALE_PLATFORM_BOT_TOKEN ||
    process.env.BALE_BOT_TOKEN ||
    ''
  ).trim();
  const providerToken = String(
    settings.bale_provider_token ||
    process.env.BALE_PLATFORM_PROVIDER_TOKEN ||
    process.env.BALE_PROVIDER_TOKEN ||
    baleCore.TEST_PROVIDER_TOKEN
  ).trim() || baleCore.TEST_PROVIDER_TOKEN;
  return {
    bot_token: botToken,
    provider_token: providerToken,
    test_mode: providerToken === baleCore.TEST_PROVIDER_TOKEN,
  };
}

function ensureWallet(accountId) {
  ensureWalletTables();
  let wallet = db.prepare('SELECT * FROM user_wallets WHERE account_id=?').get(accountId);
  if (wallet) return wallet;

  const settings = getAdminSettings();
  const dailyCost = Number(settings.daily_cost || 1000);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO user_wallets (account_id, balance, daily_cost, gift_given, last_charge_check, created_at, updated_at)
    VALUES (?, 0, ?, 1, ?, ?, ?)
  `).run(accountId, dailyCost, now, now, now);

  return db.prepare('SELECT * FROM user_wallets WHERE account_id=?').get(accountId);
}

function creditWalletBaleTopup(topup, successfulPayment) {
  const now = Math.floor(Date.now() / 1000);
  const amountToman = Number(topup.amount_toman || 0);
  const tx = db.transaction(() => {
    ensureWallet(topup.account_id);
    db.prepare('UPDATE user_wallets SET balance=balance+?, updated_at=? WHERE account_id=?')
      .run(amountToman, now, topup.account_id);
    try {
      db.prepare(`
        INSERT INTO wallet_transactions (id, account_id, type, amount, description, created_at)
        VALUES (?, ?, 'charge_bale', ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        topup.account_id,
        amountToman,
        `شارژ با بله‌پی · ${topup.id}`,
        now
      );
    } catch (e) {
      // جدول قدیمی بدون ستون جدید نیست؛ خطای تکراری id را نادیده نگیر
      throw e;
    }
    db.prepare(`
      UPDATE wallet_bale_topups
      SET status='paid', provider_charge_id=?, telegram_charge_id=?, paid_at=?, updated_at=?
      WHERE id=?
    `).run(
      String(successfulPayment?.provider_payment_charge_id || ''),
      String(successfulPayment?.telegram_payment_charge_id || ''),
      now,
      now,
      topup.id
    );
  });
  tx();
  return db.prepare('SELECT * FROM wallet_bale_topups WHERE id=?').get(topup.id);
}

router.get('/', auth, (req, res) => {
  try {
    const wallet = ensureWallet(req.user.id);
    const transactions = db.prepare(`
      SELECT id, type, amount, description, created_at
      FROM wallet_transactions
      WHERE account_id=?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.user.id);

    const creds = getPlatformBaleCreds();
    res.json({
      balance: wallet.balance || 0,
      daily_cost: wallet.daily_cost || 1000,
      transactions,
      bale_pay: { enabled: !!creds.bot_token, test_mode: creds.test_mode },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/charge-request', auth, (req, res) => {
  try {
    ensureWallet(req.user.id);
    const amount = Number(req.body.amount);
    const receiptText = String(req.body.receipt_text || '').trim();
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < MIN_CHARGE_AMOUNT) {
      return res.status(400).json({ error: 'minimum amount is 10000' });
    }
    if (amount > MAX_CHARGE_AMOUNT) {
      return res.status(400).json({ error: 'maximum amount is 10000000' });
    }

    const now = Math.floor(Date.now() / 1000);
    const info = db.prepare(`
      INSERT INTO wallet_charge_requests (id, account_id, amount, receipt_text, status, created_at, updated_at)
      VALUES (NULL, ?, ?, ?, 'pending', ?, ?)
    `).run(req.user.id, amount, receiptText, now, now);
    const id = Number(info.lastInsertRowid);

    res.status(201).json({
      success: true,
      request: { id, amount, receipt_text: receiptText, status: 'pending', created_at: now },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── شارژ آنی کیف پول با بله‌پی ──────────────────────────────────────────────
router.post('/bale-topup', auth, async (req, res) => {
  try {
    ensureWalletTables();
    ensureWallet(req.user.id);
    const amountToman = Math.round(Number(req.body?.amount ?? req.body?.amount_toman));
    const amountRial = baleCore.tomanToRial(amountToman);
    if (!amountRial) return res.status(400).json({ error: 'invalid_amount' });
    if (amountToman < MIN_CHARGE_AMOUNT) {
      return res.status(400).json({ error: 'minimum amount is 10000' });
    }
    if (amountToman > MAX_CHARGE_AMOUNT) {
      return res.status(400).json({ error: 'maximum amount is 10000000' });
    }

    const creds = getPlatformBaleCreds();
    if (!creds.bot_token) {
      return res.status(400).json({
        error: 'bale_not_configured',
        message: 'درگاه بله‌پی هنوز فعال نشده است. لطفاً از کارت‌به‌کارت استفاده کنید.',
      });
    }

    const id = 'wp_' + crypto.randomBytes(8).toString('hex');
    const title = 'شارژ کیف پول';
    const description = `شارژ کیف پول TeamPulse به مبلغ ${amountToman.toLocaleString('fa-IR')} تومان`;
    const prices = JSON.stringify([{ label: title.slice(0, 32), amount: amountRial }]);

    let baleRef = '';
    let invoiceRaw = null;
    try {
      const result = await baleCore.baleApi(creds.bot_token, 'createInvoiceLink', {
        title,
        description,
        payload: id,
        provider_token: creds.provider_token,
        prices,
      });
      invoiceRaw = result;
      if (typeof result === 'string') baleRef = result;
      else if (result && typeof result === 'object') {
        baleRef = String(result.url || result.link || result.invoice_link || result.invoiceLink || '');
      } else baleRef = String(result || '');
    } catch (e) {
      return res.status(400).json({ error: 'create_invoice_failed', message: e.message });
    }
    try {
      const rawPreview = typeof invoiceRaw === 'string'
        ? invoiceRaw.slice(0, 80)
        : String(JSON.stringify(invoiceRaw)).slice(0, 300);
      console.warn(`[wallet-bale] invoice kind=${typeof invoiceRaw} ref=${String(baleRef || '').slice(0, 80)} raw=${rawPreview} test=${creds.test_mode}`);
    } catch (e) {}
    if (!/^https?:\/\//i.test(baleRef)) {
      return res.status(400).json({
        error: 'create_invoice_failed',
        message: 'لینک پرداخت از بله دریافت نشد. توکن بازو و توکن پرداخت را بررسی کنید.',
      });
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO wallet_bale_topups
        (id, account_id, amount_toman, amount_rial, status, bale_invoice_ref, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, req.user.id, amountToman, amountRial, baleRef, now, now);

    const shareUrl = baleRef;

    res.json({
      id,
      shareUrl,
      baleRef,
      amount_toman: amountToman,
      amount_rial: amountRial,
      status: 'pending',
      test_mode: creds.test_mode,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/bale-topup/:id', auth, (req, res) => {
  try {
    ensureWalletTables();
    const row = db.prepare('SELECT * FROM wallet_bale_topups WHERE id=?').get(req.params.id);
    if (!row || row.account_id !== req.user.id) return res.status(404).json({ error: 'not_found' });
    const wallet = ensureWallet(req.user.id);
    res.json({
      id: row.id,
      status: row.status,
      amount_toman: row.amount_toman,
      bale_invoice_ref: row.bale_invoice_ref,
      paid_at: row.paid_at,
      balance: wallet.balance || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ثبت وب‌هوک بازوی پلتفرم (فقط ادمین) — ربات کیف پول باید جدا از ربات فروش باشد
router.post('/bale-webhook/register', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    ensureWalletTables();
    const creds = getPlatformBaleCreds();
    if (!creds.bot_token) return res.status(400).json({ error: 'bale_not_configured' });
    const url = `${baleCore.publicBaseUrl(req)}/api/wallet/bale-webhook`;
    if (!/^https:\/\//i.test(url)) {
      return res.status(400).json({
        error: 'webhook_failed',
        message: 'آدرس وب‌هوک باید https باشد. PUBLIC_BASE_URL را روی سرور تنظیم کنید.',
        url,
      });
    }
    await baleCore.baleApi(creds.bot_token, 'setWebhook', { url });
    res.json({ ok: true, url, test_mode: creds.test_mode });
  } catch (e) {
    res.status(400).json({ error: 'webhook_failed', message: e.message || String(e) });
  }
});

// وب‌هوک پلتفرم برای شارژ کیف پول (بدون احراز هویت؛ Bale امضا نمی‌فرستد)
router.post('/bale-webhook', async (req, res) => {
  try {
    ensureWalletTables();
    const creds = getPlatformBaleCreds();
    if (!creds.bot_token) return res.sendStatus(200);
    const update = req.body || {};

    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const payload = String(q.invoice_payload || '');
      const topup = db.prepare('SELECT * FROM wallet_bale_topups WHERE id=?').get(payload);
      const ok = !!(topup && topup.status === 'pending' && Number(q.total_amount) === Number(topup.amount_rial));
      try {
        await baleCore.baleApi(creds.bot_token, 'answerPreCheckoutQuery', {
          pre_checkout_query_id: q.id,
          ok,
          ...(ok ? {} : { error_message: 'این درخواست شارژ معتبر نیست یا منقضی شده است' }),
        });
      } catch (e) {}
      return res.sendStatus(200);
    }

    const message = update.message || update.edited_message;
    const successful = message?.successful_payment;
    if (successful) {
      const payload = String(successful.invoice_payload || '');
      const topup = db.prepare('SELECT * FROM wallet_bale_topups WHERE id=?').get(payload);
      if (topup && topup.status === 'pending'
        && Number(successful.total_amount) === Number(topup.amount_rial)) {
        try {
          creditWalletBaleTopup(topup, successful);
        } catch (e) {}
      }
    }
    return res.sendStatus(200);
  } catch (e) {
    return res.sendStatus(200);
  }
});

router._internals = { getPlatformBaleCreds, creditWalletBaleTopup, ensureWalletTables };

module.exports = router;
