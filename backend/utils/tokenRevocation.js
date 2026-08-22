function ensureTokenRevocationSchema(db) {
  const columns = db.prepare('PRAGMA table_info(accounts)').all().map(column => column.name);
  if (!columns.includes('token_version')) {
    db.prepare('ALTER TABLE accounts ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0').run();
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
  `);
}

function currentTokenVersion(db, accountId) {
  const row = db.prepare('SELECT token_version FROM accounts WHERE id=?').get(accountId);
  return Number(row && row.token_version) || 0;
}

function bumpTokenVersion(db, accountId) {
  db.prepare('UPDATE accounts SET token_version=COALESCE(token_version,0)+1 WHERE id=?').run(accountId);
  return currentTokenVersion(db, accountId);
}

function revokeJti(db, { jti, accountId, exp }) {
  const id = String(jti || '').trim();
  if (!id || !accountId) return;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return;
  db.prepare(`
    INSERT INTO revoked_tokens (jti, account_id, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(jti) DO UPDATE SET
      account_id=excluded.account_id,
      expires_at=excluded.expires_at
  `).run(id, accountId, expiresAt);
}

function isJtiRevoked(db, jti) {
  const id = String(jti || '').trim();
  if (!id) return true;
  const now = Math.floor(Date.now() / 1000);
  return !!db.prepare('SELECT 1 FROM revoked_tokens WHERE jti=? AND expires_at>=?').get(id, now);
}

function purgeExpiredRevokedTokens(db) {
  db.prepare('DELETE FROM revoked_tokens WHERE expires_at<?').run(Math.floor(Date.now() / 1000));
}

module.exports = {
  ensureTokenRevocationSchema,
  currentTokenVersion,
  bumpTokenVersion,
  revokeJti,
  isJtiRevoked,
  purgeExpiredRevokedTokens,
};
