const { verify } = require('../utils/jwt');

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
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    req.user = verify(token);
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
};
