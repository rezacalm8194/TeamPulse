const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const UNIT_SECONDS = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 };

function parseDurationToSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  const raw = String(value || '').trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) return DEFAULT_TTL_SECONDS;
  return Math.floor(Number(match[1]) * UNIT_SECONDS[match[2].toLowerCase()]);
}

function expiresInSeconds() {
  const seconds = parseDurationToSeconds(process.env.JWT_EXPIRES_IN || '8h');
  return Math.min(Math.max(seconds, 60), MAX_TTL_SECONDS);
}

module.exports = {
  MAX_TTL_SECONDS,
  sign: (payload = {}) => {
    const id = payload.id;
    if (!id) throw new Error('jwt payload requires id');
    return jwt.sign({ id }, SECRET, { expiresIn: expiresInSeconds() });
  },
  verify: (token) => {
    const payload = jwt.verify(token, SECRET);
    const id = payload && payload.id;
    const iat = Number(payload && payload.iat);
    const exp = Number(payload && payload.exp);
    if (!id || !Number.isFinite(iat) || !Number.isFinite(exp) || exp - iat > MAX_TTL_SECONDS) {
      const error = new Error('invalid token');
      error.name = 'JsonWebTokenError';
      throw error;
    }
    return { id };
  }
};
