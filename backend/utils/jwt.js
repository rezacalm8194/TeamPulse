const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET;

module.exports = {
  sign: (payload) => jwt.sign(payload, SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }),
  verify: (token) => jwt.verify(token, SECRET)
};
