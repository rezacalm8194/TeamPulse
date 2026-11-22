const { verify } = require('../utils/jwt');
const db = require('../config/database');
const { logger } = require('../utils/logger');
const {
  ensureTokenRevocationSchema,
  isJtiRevoked,
  currentTokenVersion,
} = require('../utils/tokenRevocation');
const {
  ensureAccountTrashSchema,
  ACCOUNT_DEACTIVATED_MESSAGE,
} = require('../utils/accountTrash');

ensureTokenRevocationSchema(db);
ensureAccountTrashSchema(db);

function takeBodyToken(req) {
  // sendBeacon cannot set Authorization. Putting the JWT in the query string
  // leaked it through proxy access logs and same-origin Referer. A POST body
  // field stays off the URL; strip it so handlers never persist it.
  if (req.method !== 'POST' || !req.body || typeof req.body !== 'object') return null;
  const token = req.body.token;
  if (typeof token !== 'string' || !token) return null;
  delete req.body.token;
  return token;
}

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  let token = null;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else {
    token = takeBodyToken(req);
  }
  if (!token) {
    logger.warn('unauthorized_access', { requestId: req.requestId, path: req.path, ip: req.ip });
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const payload = verify(token);
    if (isJtiRevoked(db, payload.jti)) {
      logger.warn('invalid_token', {
        requestId: req.requestId, path: req.path, ip: req.ip, errorCode: 'TokenRevoked',
      });
      return res.status(401).json({ error: 'invalid token' });
    }
    const account = db.prepare(
      'SELECT id, email, role, is_active, deleted_at FROM accounts WHERE id=?'
    ).get(payload.id);
    if (!account || Number(account.is_active) !== 1) {
      logger.warn('unauthorized_access', { requestId: req.requestId, path: req.path, ip: req.ip });
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (account.deleted_at) {
      return res.status(403).json({ error: 'account_deactivated', message: ACCOUNT_DEACTIVATED_MESSAGE });
    }
    if (currentTokenVersion(db, account.id) !== payload.tv) {
      logger.warn('invalid_token', {
        requestId: req.requestId, path: req.path, ip: req.ip, errorCode: 'TokenVersionMismatch',
      });
      return res.status(401).json({ error: 'invalid token' });
    }
    req.user = {
      id: account.id,
      email: account.email,
      role: account.role,
      jti: payload.jti,
      exp: payload.exp,
    };
    next();
  } catch (error) {
    logger.warn(error.name === 'TokenExpiredError' ? 'session_expired' : 'invalid_token', {
      requestId: req.requestId, path: req.path, ip: req.ip, errorCode: error.name,
    });
    res.status(401).json({ error: 'invalid token' });
  }
};
