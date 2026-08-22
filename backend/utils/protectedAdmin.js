function parseCsv(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getProtectedEmails(env = process.env) {
  return new Set(parseCsv(env.PROTECTED_ADMIN_EMAILS));
}

function getProtectedIds(env = process.env) {
  return new Set(parseCsv(env.PROTECTED_ADMIN_IDS));
}

function isConfiguredProtectedAccount(account, env = process.env) {
  if (!account) return false;
  const id = String(account.id || '').trim().toLowerCase();
  if (id && getProtectedIds(env).has(id)) return true;
  const email = String(account.email || '').trim().toLowerCase();
  return Boolean(email && getProtectedEmails(env).has(email));
}

function countAdmins(db) {
  return Number(db.prepare("SELECT COUNT(*) FROM accounts WHERE role='admin'").pluck().get() || 0);
}

function isLastAdmin(db, account) {
  return String(account?.role || '') === 'admin' && countAdmins(db) <= 1;
}

function isProtectedAccount(db, account, env = process.env) {
  if (!account) return false;
  return isConfiguredProtectedAccount(account, env) || isLastAdmin(db, account);
}

function withProtectedFlag(db, account, env = process.env) {
  if (!account) return account;
  return { ...account, is_protected: isProtectedAccount(db, account, env) };
}

module.exports = {
  countAdmins,
  isConfiguredProtectedAccount,
  isLastAdmin,
  isProtectedAccount,
  withProtectedFlag,
};
