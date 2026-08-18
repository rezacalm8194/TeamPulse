const { verify } = require('../utils/jwt');
const { logger } = require('../utils/logger');

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  // navigator.sendBeacon() (used to flush the last save when a tab/browser
  // closes) cannot set custom headers, so it can't send an Authorization
  // header. As a fallback for that case only, accept the token via a
  // `token` query-string param.
  let token = null;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (typeof req.query?.token === 'string' && req.query.token) {
    token = req.query.token;
  }
  if (!token) {
    logger.warn('unauthorized_access', { requestId: req.requestId, path: req.path, ip: req.ip });
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    req.user = verify(token);
    next();
  } catch (error) {
    logger.warn(error.name === 'TokenExpiredError' ? 'session_expired' : 'invalid_token', {
      requestId: req.requestId, path: req.path, ip: req.ip, errorCode: error.name,
    });
    res.status(401).json({ error: 'invalid token' });
  }
};
