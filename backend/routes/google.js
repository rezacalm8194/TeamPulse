const router = require('express').Router();
const auth = require('../middleware/auth');
const { logger } = require('../utils/logger');
const {
  ensureGoogleDriveOauthSchema,
  isConfigured,
  resolveOauthAccountId,
  readStatus,
  deleteRefresh,
  exchangeCode,
  refreshAccess,
} = require('../utils/googleDriveOauth');

ensureGoogleDriveOauthSchema();

const FA = {
  google_oauth_not_configured: 'ورود ماندگار گوگل روی سرور تنظیم نشده (GOOGLE_OAUTH_CLIENT_SECRET)',
  missing_code: 'کد ورود گوگل دریافت نشد',
  invalid_redirect_uri: 'آدرس بازگشت گوگل نامعتبر است',
  no_refresh_token: 'گوگل توکن ماندگار نداد؛ دوباره از تنظیمات اتصال را بزن',
  no_access_token: 'گوگل توکن دسترسی نداد',
  not_connected: 'هنوز به گوگل وصل نشده',
  invalid_grant: 'اتصال گوگل منقضی شده؛ دوباره از تنظیمات وصل شو',
  google_unreachable: 'سرور فعلاً به گوگل دسترسی ندارد؛ اتصال حفظ شده و دوباره تلاش می‌شود',
  forbidden: 'دسترسی مجاز نیست',
};

function sendErr(req, res, err) {
  const status = Number(err.status) || 500;
  const key = err.message || 'google_oauth_failed';
  logger.warn('google_drive_oauth', {
    requestId: req.requestId,
    path: req.path,
    status,
    error: key,
  });
  res.status(status).json({
    error: key,
    message: FA[key] || 'اتصال گوگل انجام نشد',
  });
}

router.get('/drive/status', auth, (req, res) => {
  try {
    const accountId = resolveOauthAccountId(req);
    const st = readStatus(accountId);
    if (st.undecryptable) {
      logger.warn('google_drive_oauth_undecryptable', { requestId: req.requestId, accountId });
    }
    res.json({
      configured: isConfigured(),
      connected: st.connected,
      email: st.connected ? st.email : '',
      account_id: accountId,
    });
  } catch (err) {
    sendErr(req, res, err);
  }
});

router.post('/drive/exchange', auth, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const accountId = resolveOauthAccountId(req);
    const tokens = await exchangeCode({
      accountId,
      code: String(body.code || ''),
      redirectUri: String(body.redirect_uri || ''),
      codeVerifier: String(body.code_verifier || ''),
    });
    res.json(tokens);
  } catch (err) {
    sendErr(req, res, err);
  }
});

router.post('/drive/refresh', auth, async (req, res) => {
  try {
    const accountId = resolveOauthAccountId(req);
    const tokens = await refreshAccess(accountId);
    res.json(tokens);
  } catch (err) {
    sendErr(req, res, err);
  }
});

router.delete('/drive', auth, (req, res) => {
  try {
    const accountId = resolveOauthAccountId(req);
    deleteRefresh(accountId);
    res.json({ ok: true, account_id: accountId });
  } catch (err) {
    sendErr(req, res, err);
  }
});

// ── Google Calendar: same persistent-login flow as Drive ───────────────────
const gcal = require('../utils/googleCalendarOauth');
gcal.ensureGoogleCalendarOauthSchema();

router.get('/calendar/status', auth, (req, res) => {
  try {
    const accountId = resolveOauthAccountId(req);
    const st = gcal.readStatus(accountId);
    if (st.undecryptable) {
      logger.warn('google_calendar_oauth_undecryptable', { requestId: req.requestId, accountId });
    }
    res.json({
      configured: isConfigured(),
      connected: st.connected,
      email: st.connected ? st.email : '',
      account_id: accountId,
    });
  } catch (err) {
    sendErr(req, res, err);
  }
});

router.post('/calendar/exchange', auth, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const accountId = resolveOauthAccountId(req);
    const tokens = await gcal.exchangeCode({
      accountId,
      code: String(body.code || ''),
      redirectUri: String(body.redirect_uri || ''),
      codeVerifier: String(body.code_verifier || ''),
    });
    res.json(tokens);
  } catch (err) {
    sendErr(req, res, err);
  }
});

router.post('/calendar/refresh', auth, async (req, res) => {
  try {
    const accountId = resolveOauthAccountId(req);
    const tokens = await gcal.refreshAccess(accountId);
    res.json(tokens);
  } catch (err) {
    sendErr(req, res, err);
  }
});

router.delete('/calendar', auth, (req, res) => {
  try {
    const accountId = resolveOauthAccountId(req);
    gcal.deleteRefresh(accountId);
    res.json({ ok: true, account_id: accountId });
  } catch (err) {
    sendErr(req, res, err);
  }
});

module.exports = router;
