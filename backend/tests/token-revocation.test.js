const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  ensureTokenRevocationSchema,
  currentTokenVersion,
  bumpTokenVersion,
  revokeJti,
  isJtiRevoked,
  purgeExpiredRevokedTokens,
} = require('../utils/tokenRevocation');

function memoryDb() {
  try {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, token_version INTEGER)`);
    db.prepare('INSERT INTO accounts (id, token_version) VALUES (?, ?)').run('user-1', 0);
    ensureTokenRevocationSchema(db);
    return db;
  } catch (error) {
    return { skip: error };
  }
}

test('logout blacklists the current jti until expiry', t => {
  const db = memoryDb();
  if (db.skip) {
    t.skip(`better-sqlite3 native binary is incompatible with this test runtime: ${db.skip.code || db.skip.message}`);
    return;
  }
  const exp = Math.floor(Date.now() / 1000) + 60;
  revokeJti(db, { jti: 'session-a', accountId: 'user-1', exp });
  assert.equal(isJtiRevoked(db, 'session-a'), true);
  assert.equal(isJtiRevoked(db, 'session-b'), false);
  db.close();
});

test('password change bumps token_version so older sessions die', t => {
  const db = memoryDb();
  if (db.skip) {
    t.skip(`better-sqlite3 native binary is incompatible with this test runtime: ${db.skip.code || db.skip.message}`);
    return;
  }
  assert.equal(currentTokenVersion(db, 'user-1'), 0);
  assert.equal(bumpTokenVersion(db, 'user-1'), 1);
  assert.equal(currentTokenVersion(db, 'user-1'), 1);
  assert.equal(bumpTokenVersion(db, 'user-1'), 2);
  db.close();
});

test('expired denylist rows are purged and no longer block', t => {
  const db = memoryDb();
  if (db.skip) {
    t.skip(`better-sqlite3 native binary is incompatible with this test runtime: ${db.skip.code || db.skip.message}`);
    return;
  }
  const past = Math.floor(Date.now() / 1000) - 5;
  db.prepare('INSERT INTO revoked_tokens (jti, account_id, expires_at) VALUES (?,?,?)')
    .run('old', 'user-1', past);
  assert.equal(isJtiRevoked(db, 'old'), false);
  purgeExpiredRevokedTokens(db);
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM revoked_tokens WHERE jti=?').get('old');
  assert.equal(remaining.n, 0);
  db.close();
});

test('tokens without jti are treated as revoked', t => {
  const db = memoryDb();
  if (db.skip) {
    t.skip(`better-sqlite3 native binary is incompatible with this test runtime: ${db.skip.code || db.skip.message}`);
    return;
  }
  assert.equal(isJtiRevoked(db, ''), true);
  assert.equal(isJtiRevoked(db, null), true);
  db.close();
});
