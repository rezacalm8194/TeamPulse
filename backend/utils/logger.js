const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const MAX_BYTES = Math.max(64 * 1024, Number(process.env.LOG_MAX_BYTES) || 5 * 1024 * 1024);
const MAX_FILES = Math.max(1, Number(process.env.LOG_MAX_FILES) || 5);
const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const SENSITIVE_KEY = /(?:password|passcode|otp|token|authorization|cookie|secret|api[-_]?key|credential|session|private[-_]?key)/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const QUERY_SECRET = /([?&](?:token|access_token|refresh_token|api_key)=)[^&#\s]*/gi;

function sanitize(value, seen = new WeakSet()) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(JWT, '[REDACTED]')
    .replace(QUERY_SECRET, '$1[REDACTED]')
    .slice(0, 2000);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitize(value.message),
      code: value.code ? sanitize(String(value.code)) : undefined,
      stack: process.env.NODE_ENV === 'production' ? undefined : sanitize(value.stack || ''),
    };
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, seen));
  const clean = {};
  Object.entries(value).slice(0, 100).forEach(([key, item]) => {
    clean[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(item, seen);
  });
  return clean;
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotate(filePath) {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < MAX_BYTES) return;
    const oldest = `${filePath}.${MAX_FILES}`;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    for (let i = MAX_FILES - 1; i >= 1; i -= 1) {
      const source = `${filePath}.${i}`;
      if (fs.existsSync(source)) fs.renameSync(source, `${filePath}.${i + 1}`);
    }
    fs.renameSync(filePath, `${filePath}.1`);
  } catch (error) {
    process.stderr.write(`[logger] rotation failed: ${error.message}\n`);
  }
}

function destinations(level, category) {
  const files = new Set(['app.log']);
  if (level === 'error') files.add('error.log');
  if (category === 'audit') files.add('audit.log');
  return [...files];
}

function buildEntry(level, event, fields = {}, category = 'application') {
  return sanitize({
    timestamp: new Date().toISOString(),
    level: LEVELS.has(level) ? level : 'info',
    category,
    event: String(event || 'application_event'),
    ...fields,
  });
}

function write(level, event, fields = {}, options = {}) {
  if (level === 'debug' && process.env.NODE_ENV === 'production' && process.env.LOG_LEVEL !== 'debug') return;
  const entry = buildEntry(level, event, fields, options.category);
  const line = `${JSON.stringify(entry)}\n`;
  try {
    ensureLogDir();
    destinations(entry.level, entry.category).forEach(file => {
      const filePath = path.join(LOG_DIR, file);
      rotate(filePath);
      fs.appendFile(filePath, line, error => {
        if (error) process.stderr.write(`[logger] write failed: ${error.message}\n`);
      });
    });
  } catch (error) {
    process.stderr.write(`[logger] write failed: ${error.message}\n`);
  }
  return entry;
}

function writeSync(level, event, fields = {}, options = {}) {
  const entry = buildEntry(level, event, fields, options.category);
  const line = `${JSON.stringify(entry)}\n`;
  try {
    ensureLogDir();
    destinations(entry.level, entry.category).forEach(file => {
      const filePath = path.join(LOG_DIR, file);
      rotate(filePath);
      fs.appendFileSync(filePath, line);
    });
  } catch (error) {
    process.stderr.write(`[logger] synchronous write failed: ${error.message}\n`);
  }
  return entry;
}

const logger = {
  debug: (event, fields) => write('debug', event, fields),
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
  audit: (event, fields, level = 'info') => write(level, event, fields, { category: 'audit' }),
  fatal: (event, fields) => writeSync('error', event, fields),
};

module.exports = { logger, sanitize, LOG_DIR };
