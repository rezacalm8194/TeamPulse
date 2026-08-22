const PRODUCTION_ORIGINS = Object.freeze([
  'https://teampulse.ir',
  'https://www.teampulse.ir',
]);

const DEVELOPMENT_ORIGINS = Object.freeze([
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function parseCorsOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin && origin !== '*');
}

function defaultCorsOrigins(nodeEnv) {
  if (nodeEnv === 'production') return [...PRODUCTION_ORIGINS];
  return [...DEVELOPMENT_ORIGINS];
}

function resolveCorsOrigins({ allowedOrigins, corsOrigins, nodeEnv } = {}) {
  const configured = parseCorsOrigins(allowedOrigins || corsOrigins);
  if (configured.length) {
    return { origins: configured, defaulted: false };
  }
  return { origins: defaultCorsOrigins(nodeEnv), defaulted: true };
}

function isCorsOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  return Array.isArray(allowedOrigins) && allowedOrigins.includes(origin);
}

module.exports = {
  PRODUCTION_ORIGINS,
  DEVELOPMENT_ORIGINS,
  parseCorsOrigins,
  defaultCorsOrigins,
  resolveCorsOrigins,
  isCorsOriginAllowed,
};
