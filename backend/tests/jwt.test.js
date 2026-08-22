const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'jwt-unit-test-secret';
delete process.env.JWT_EXPIRES_IN;

const jwtPath = require.resolve('../utils/jwt');
delete require.cache[jwtPath];
const { sign, verify, MAX_TTL_SECONDS } = require('../utils/jwt');

test('session tokens omit role and last at most 8 hours by default', () => {
  const token = sign({ id: 'user-1', email: 'a@b.c', role: 'admin' });
  const decoded = jwt.decode(token);
  assert.equal(decoded.id, 'user-1');
  assert.equal(decoded.role, undefined);
  assert.equal(decoded.email, undefined);
  assert.ok(decoded.exp - decoded.iat <= 8 * 60 * 60);
  assert.deepEqual(verify(token), { id: 'user-1' });
});

test('legacy long-lived tokens are rejected even if signature is valid', () => {
  const token = jwt.sign({ id: 'user-1', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '3650d' });
  const decoded = jwt.decode(token);
  assert.ok(decoded.exp - decoded.iat > MAX_TTL_SECONDS);
  assert.throws(() => verify(token), { name: 'JsonWebTokenError' });
});
