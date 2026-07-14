const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const allowedCorsOrigins = (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const corsOptions = allowedCorsOrigins.length
  ? {
      origin(origin, callback) {
        if (!origin || allowedCorsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('cors_origin_not_allowed'));
      },
      credentials: false,
    }
  : { origin: '*', credentials: false };
const cspReportOnlyValue = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://translate.google.com https://translate.googleapis.com",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https:",
  "media-src 'self' blob: data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');
app.use(helmet({ contentSecurityPolicy: false }));
function securityHeaders(req, res, next) {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
}
function reportOnlyCsp(req, res, next) {
  res.setHeader('Content-Security-Policy-Report-Only', cspReportOnlyValue);
  next();
}
function noStoreApi(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
function sanitizeServerErrors(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = body => {
    if (process.env.NODE_ENV === 'production' && res.statusCode >= 500 && body && typeof body === 'object') {
      console.error('[server-error-response]', {
        path: req.originalUrl,
        status: res.statusCode,
        error: body.error || null,
        message: body.message || null,
      });
      return originalJson({ error: 'internal_server_error' });
    }
    return originalJson(body);
  };
  next();
}
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeServerErrors);
const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts' },
});
app.use('/api/auth/login', authLoginLimiter);
app.use('/api/', noStoreApi);
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 2000 }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/files', require('./routes/files'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/data', require('./routes/data'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/share', require('./routes/share'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/speech', require('./routes/speech'));
console.log('Speech API loaded');
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));
app.get('/share/:token', require('./routes/share').serveShare);
app.get('/app', reportOnlyCsp, (req,res) => res.sendFile(path.join(__dirname, '../app.html')));
app.use('/api', (req, res) => res.status(404).json({
  error: 'api_route_not_found',
  path: req.originalUrl,
  message: 'API route was not found on this server',
}));
function blockSensitiveStatic(req, res, next) {
  const p = req.path.replace(/\\/g, '/');
  const blockedPath = /^\/(?:backend|\.git|\.agents|\.codex|\.trash|win_package)(?:\/|$)/i;
  const blockedFile = /(?:^|\/)(?:\.env(?:\..*)?|server(?:\.backup-before-speech-fix)?\.js|changed\.tmp|git|deploy-.*\.bat)$/i;
  const blockedExt = /\.(?:db|sqlite|sqlite3|db-shm|db-wal|pem|key|crt|bak)$/i;
  if (blockedPath.test(p) || blockedFile.test(p) || blockedExt.test(p)) {
    return res.status(404).send('Not found');
  }
  next();
}
function setStaticCacheHeaders(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Security-Policy-Report-Only', cspReportOnlyValue);
  } else if (/\.(?:css|js|png|jpe?g|webp|gif|svg|ico|woff2?|ttf)$/i.test(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
}
app.use(blockSensitiveStatic);
app.use(express.static(path.join(__dirname, '../'), {
  dotfiles: 'ignore',
  index: false,
  fallthrough: true,
  setHeaders: setStaticCacheHeaders,
}));
app.use(reportOnlyCsp, (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
app.listen(PORT, () => console.log('TeamPulse API on port ' + PORT));
module.exports = app;
