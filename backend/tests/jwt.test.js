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
  const verified = verify(token);
  assert.equal(verified.id, 'user-1');
  assert.equal(verified.tv, 0);
  assert.equal(typeof verified.jti, 'string');
  assert.ok(verified.jti.length > 0);
  assert.equal(typeof verified.exp, 'number');
});

test('tokens without jti or version are rejected', () => {
  const token = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '8h' });
  assert.throws(() => verify(token), { name: 'JsonWebTokenError' });
});

test('legacy long-lived tokens are rejected even if signature is valid', () => {
  const token = jwt.sign({ id: 'user-1', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '3650d' });
  const decoded = jwt.decode(token);
  assert.ok(decoded.exp - decoded.iat > MAX_TTL_SECONDS);
  assert.throws(() => verify(token), { name: 'JsonWebTokenError' });
});

test('missing JWT_SECRET fails when the module loads', () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = '';
  delete require.cache[jwtPath];
  try {
    assert.throws(() => require('../utils/jwt'), /JWT_SECRET is required/);
  } finally {
    process.env.JWT_SECRET = previous;
    delete require.cache[jwtPath];
    require('../utils/jwt');
  }
});
