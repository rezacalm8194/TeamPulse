const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRODUCTION_ORIGINS,
  DEVELOPMENT_ORIGINS,
  parseCorsOrigins,
  resolveCorsOrigins,
  isCorsOriginAllowed,
} = require('../utils/corsOrigins');

test('wildcard and empty env values are stripped', () => {
  assert.deepEqual(parseCorsOrigins(''), []);
  assert.deepEqual(parseCorsOrigins('*'), []);
  assert.deepEqual(parseCorsOrigins(' * , '), []);
  assert.deepEqual(
    parseCorsOrigins('https://teampulse.ir, *, https://www.teampulse.ir'),
    ['https://teampulse.ir', 'https://www.teampulse.ir'],
  );
});

test('empty ALLOWED_ORIGINS never falls back to *', () => {
  const production = resolveCorsOrigins({ nodeEnv: 'production' });
  assert.equal(production.defaulted, true);
  assert.deepEqual(production.origins, [...PRODUCTION_ORIGINS]);
  assert.equal(production.origins.includes('*'), false);

  const development = resolveCorsOrigins({ nodeEnv: 'development' });
  assert.equal(development.defaulted, true);
  assert.deepEqual(development.origins, [...DEVELOPMENT_ORIGINS]);
  assert.equal(development.origins.includes('*'), false);
});

test('explicit origins win over defaults', () => {
  const resolved = resolveCorsOrigins({
    allowedOrigins: 'https://app.example.com',
    nodeEnv: 'production',
  });
  assert.equal(resolved.defaulted, false);
  assert.deepEqual(resolved.origins, ['https://app.example.com']);
});

test('browser origins outside the allowlist are rejected', () => {
  const allowed = [...PRODUCTION_ORIGINS];
  assert.equal(isCorsOriginAllowed(undefined, allowed), true);
  assert.equal(isCorsOriginAllowed('https://teampulse.ir', allowed), true);
  assert.equal(isCorsOriginAllowed('https://evil.example', allowed), false);
});
