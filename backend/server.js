const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('./utils/jwt');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');
const db = require('./config/database');
const { logger, classifySyncOutcome } = require('./utils/logger');
const { resolveCorsOrigins, isCorsOriginAllowed } = require('./utils/corsOrigins');
const { initTodoAuditStore, seedHistoricalRecurringSnapshots, migrateTodoAuditOccurrenceIdentityV2, flushPendingTodoAudits } = require('./utils/todoAuditStore');
const { backfillVersionSummaries } = require('./utils/versionSnapshots');
initTodoAuditStore(db);
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
app.use((req, res, next) => {
  req.requestId = String(req.headers['x-request-id'] || randomUUID()).slice(0, 128);
  res.setHeader('X-Request-ID', req.requestId);
  const startedAt = Date.now();
  const isSync = req.path.startsWith('/api/data/') || req.path.startsWith('/api/sync');
  if (isSync) logger.info('sync_started', { requestId: req.requestId, method: req.method, path: req.path });
  res.on('finish', () => {
    const fields = {
      requestId: req.requestId,
      userId: req.user?.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: Date.now() - startedAt,
    };
    const syncOutcome = isSync ? classifySyncOutcome(res.statusCode) : null;
    if (syncOutcome) logger[syncOutcome.level](syncOutcome.event, fields);
    if (res.statusCode === 403) logger.warn('permission_denied', { ...fields, ip: req.ip });
    if (res.statusCode >= 500) logger.error('api_error', fields);
  });
  next();
});
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_nocase ON accounts(lower(trim(email)))');
} catch (error) {
  // A legacy case-only duplicate must be removed once by an admin before the
  // database can enforce the new invariant. Registration still performs its
  // normalized lookup in the meantime.
  console.error('[accounts] case-insensitive email index pending:', error.message);
}
const { origins: allowedCorsOrigins, defaulted: corsOriginsDefaulted } = resolveCorsOrigins({
  allowedOrigins: process.env.ALLOWED_ORIGINS,
  corsOrigins: process.env.CORS_ORIGINS,
  nodeEnv: process.env.NODE_ENV,
});
if (corsOriginsDefaulted) {
  logger.warn('cors_origins_defaulted', {
    origins: allowedCorsOrigins,
    nodeEnv: process.env.NODE_ENV || 'development',
  });
}
const corsOptions = {
  origin(origin, callback) {
    if (isCorsOriginAllowed(origin, allowedCorsOrigins)) return callback(null, true);
    return callback(new Error('cors_origin_not_allowed'));
  },
  credentials: false,
};
const cspValue = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://translate.google.com https://translate.googleapis.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https:",
  "media-src 'self' blob: data:",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://translate.google.com",
  "child-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://translate.google.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
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
function applyCsp(req, res, next) {
  res.setHeader('Content-Security-Policy', cspValue);
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
      logger.error('server_error_response', {
        requestId: req.requestId,
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
app.use((err, req, res, next) => {
  if (err && err.message === 'cors_origin_not_allowed') {
    return res.status(403).json({ error: 'cors_origin_not_allowed' });
  }
  return next(err);
});
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
const authRegisterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_register_attempts' },
});
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_admin_requests' },
});
const backupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_backup_requests' },
});
const speechLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_speech_requests' },
});
app.use('/api/auth/login', authLoginLimiter);
app.use('/api/auth/register', authRegisterLimiter);
app.use('/api/', noStoreApi);
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 2000 }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/files', require('./routes/files'));
app.use('/api/backup', backupLimiter, require('./routes/backup'));
app.use('/api/data', require('./routes/data'));
app.use('/api/admin', adminLimiter, require('./routes/admin'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/share', require('./routes/share'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/speech', speechLimiter, require('./routes/speech'));
console.log('Speech API loaded');
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  version: '1.0.0',
  capabilities: { workspaces: true },
}));
app.get('/share/:token', require('./routes/share').serveShare);
app.get('/app', applyCsp, (req,res) => res.sendFile(path.join(__dirname, '../app.html')));
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
    res.setHeader('Content-Security-Policy', cspValue);
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
app.use(applyCsp, (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  logger.info('application_started', { port: PORT, host: HOST });
  setImmediate(() => {
    try {
      seedHistoricalRecurringSnapshots(db);
      migrateTodoAuditOccurrenceIdentityV2(db);
      backfillVersionSummaries(db);
      void flushPendingTodoAudits(db, logger);
    } catch (error) {
      logger.error('startup_job_failed', { error });
    }
  });
});
let shuttingDown = false;
function shutdownAfterFatal(event, error) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.fatal(event, { error });
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('unhandledRejection', reason => {
  logger.fatal('unhandled_rejection', { error: reason instanceof Error ? reason : String(reason) });
});
process.on('uncaughtException', error => {
  shutdownAfterFatal('uncaught_exception', error);
});
module.exports = app;
