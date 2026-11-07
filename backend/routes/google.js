const router = require('express').Router();
const auth = require('../middleware/auth');
const { logger } = require('../utils/logger');
const {
  ensureGoogleDriveOauthSchema,
  isConfigured,
  hasRefresh,
  deleteRefresh,
  exchangeCode,
  refreshAccess,
} = require('../utils/googleDriveOauth');

ensureGoogleDriveOauthSchema();

const FA = {
  google_oauth_not_configured: 'ورود ماندگار Drive روی سرور تنظیم نشده',
  missing_code: 'کد ورود گوگل دریافت نشد',
  invalid_redirect_uri: 'آدرس بازگشت گوگل نامعتبر است',
  no_refresh_token: 'گوگل توکن ماندگار نداد؛ دوباره از تنظیمات اتصال Drive را بزن',
  no_access_token: 'گوگل توکن دسترسی نداد',
  not_connected: 'هنوز به گوگل درایو وصل نشده',
  invalid_grant: 'اتصال گوگل منقضی شده؛ دوباره از تنظیمات وصل شو',
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
  res.json({
    configured: isConfigured(),
    connected: hasRefresh(req.user.id),
  });
});

router.post('/drive/exchange', auth, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const tokens = await exchangeCode({
      accountId: req.user.id,
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
    const tokens = await refreshAccess(req.user.id);
    res.json(tokens);
  } catch (err) {
    sendErr(req, res, err);
  }
});

router.delete('/drive', auth, (req, res) => {
  deleteRefresh(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
