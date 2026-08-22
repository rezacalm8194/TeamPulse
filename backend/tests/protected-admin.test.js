const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isConfiguredProtectedAccount,
  isLastAdmin,
  isProtectedAccount,
  withProtectedFlag,
} = require('../utils/protectedAdmin');

function mockDb(adminCount) {
  return {
    prepare() {
      return {
        pluck() {
          return { get: () => adminCount };
        },
      };
    },
  };
}

test('configured protection matches env emails and ids, never a hardcoded address', () => {
  const env = {
    PROTECTED_ADMIN_EMAILS: 'owner@example.com, Second@Example.COM',
    PROTECTED_ADMIN_IDS: 'abc-123',
  };
  assert.equal(isConfiguredProtectedAccount({ email: 'owner@example.com' }, env), true);
  assert.equal(isConfiguredProtectedAccount({ email: 'SECOND@example.com' }, env), true);
  assert.equal(isConfiguredProtectedAccount({ id: 'ABC-123', email: 'other@x.com' }, env), true);
  assert.equal(isConfiguredProtectedAccount({ email: 'nobody@example.com' }, env), false);
});

test('last remaining admin is protected even without env', () => {
  const db = mockDb(1);
  const account = { id: 'u1', email: 'admin@site.test', role: 'admin' };
  assert.equal(isLastAdmin(db, account), true);
  assert.equal(isProtectedAccount(db, account, {}), true);
  assert.equal(withProtectedFlag(db, account, {}).is_protected, true);
});

test('extra admins are not protected unless listed in env', () => {
  const db = mockDb(2);
  const account = { id: 'u2', email: 'other-admin@site.test', role: 'admin' };
  assert.equal(isProtectedAccount(db, account, {}), false);
  assert.equal(
    isProtectedAccount(db, account, { PROTECTED_ADMIN_EMAILS: 'other-admin@site.test' }),
    true
  );
});
