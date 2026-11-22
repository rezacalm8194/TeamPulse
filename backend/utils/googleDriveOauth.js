const db = require('../config/database');
const { encryptSecret, decryptSecret } = require('./secretBox');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)';
const GOOGLE_TIMEOUT_MS = 15000;
const DEFAULT_CLIENT_ID = '4364778189-8mh8qa6smrtv6q7bjrhg0et8at391mje.apps.googleusercontent.com';

function clientId() {
  return String(process.env.GOOGLE_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID).trim();
}

function clientSecret() {
  return String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
}

function isConfigured() {
  return !!(clientId() && clientSecret());
}

function resolveOauthAccountId(req) {
  const requested = String(
    (req && req.body && typeof req.body === 'object' && req.body.account_id) ||
    (req && req.query && req.query.account_id) ||
    ''
  ).trim();
  const selfId = String(req?.user?.id || '');
  if (!requested || requested === selfId) return selfId;
  if (req?.user?.role !== 'admin') {
    throw fail(403, 'forbidden');
  }
  return requested;
}

function allowedRedirect(uri) {
  const value = String(uri || '');
  const allow = new Set([
    'https://teampulse.ir/oauth_callback.html',
    'https://www.teampulse.ir/oauth_callback.html',
  ]);
  if (allow.has(value)) return true;
  try {
    const parsed = new URL(value);
    if (parsed.pathname !== '/oauth_callback.html') return false;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
  } catch {
    return false;
  }
  return false;
}

function ensureGoogleDriveOauthSchema(database = db) {
  database.prepare(`
    CREATE TABLE IF NOT EXISTS google_drive_oauth (
      account_id TEXT PRIMARY KEY,
      refresh_token TEXT NOT NULL,
      scope TEXT,
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `).run();
  try {
    const cols = database.prepare('PRAGMA table_info(google_drive_oauth)').all();
    if (!cols.some((c) => c.name === 'email')) {
      database.prepare('ALTER TABLE google_drive_oauth ADD COLUMN email TEXT').run();
    }
  } catch (e) {}
}

function persistEmail(accountId, email, database = db) {
  const value = String(email || '').trim().toLowerCase();
  if (!accountId || !value) return;
  ensureGoogleDriveOauthSchema(database);
  database.prepare('UPDATE google_drive_oauth SET email=? WHERE account_id=?').run(value, accountId);
}

function readEmail(accountId, database = db) {
  ensureGoogleDriveOauthSchema(database);
  const row = database.prepare('SELECT email FROM google_drive_oauth WHERE account_id=?').get(accountId);
  return (row && row.email) || '';
}

// A row whose token can no longer be decrypted (e.g. JWT_SECRET /
// TOKEN_ENCRYPTION_KEY changed on the server) is not a usable connection.
function readStatus(accountId, database = db) {
  ensureGoogleDriveOauthSchema(database);
  const row = database.prepare(
    'SELECT refresh_token, email FROM google_drive_oauth WHERE account_id=?'
  ).get(accountId);
  if (!row) return { connected: false, email: '', undecryptable: false };
  const plain = decryptSecret(row.refresh_token);
  return { connected: !!plain, email: row.email || '', undecryptable: !plain };
}

function persistRefresh(accountId, refreshToken, scope, database = db) {
  if (!accountId || !refreshToken) return;
  ensureGoogleDriveOauthSchema(database);
  database.prepare(`
    INSERT INTO google_drive_oauth (account_id, refresh_token, scope, updated_at)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(account_id) DO UPDATE SET
      refresh_token=excluded.refresh_token,
      scope=COALESCE(excluded.scope, google_drive_oauth.scope),
      updated_at=excluded.updated_at
  `).run(accountId, encryptSecret(refreshToken), scope || null);
}

function readRefresh(accountId, database = db) {
  ensureGoogleDriveOauthSchema(database);
  const row = database.prepare(
    'SELECT refresh_token FROM google_drive_oauth WHERE account_id=?'
  ).get(accountId);
  return row ? decryptSecret(row.refresh_token) : '';
}

function deleteRefresh(accountId, database = db) {
  ensureGoogleDriveOauthSchema(database);
  database.prepare('DELETE FROM google_drive_oauth WHERE account_id=?').run(accountId);
}

function hasRefresh(accountId, database = db) {
  ensureGoogleDriveOauthSchema(database);
  const row = database.prepare(
    'SELECT 1 AS ok FROM google_drive_oauth WHERE account_id=?'
  ).get(accountId);
  return !!row;
}

function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
  } catch (e) {}
  return undefined;
}

// Network hiccups between the server and Google (timeouts, resets, 5xx) are
// transient: they must never be reported as "disconnected" and never delete
// the stored refresh token. One retry smooths over short outages.
async function googleTokenRequest(params, fetchImpl = fetch, attempt = 0) {
  let res;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: timeoutSignal(GOOGLE_TIMEOUT_MS),
    });
  } catch (netErr) {
    if (attempt < 1) return googleTokenRequest(params, fetchImpl, attempt + 1);
    const err = new Error('google_unreachable');
    err.status = 503;
    err.code = 'google_unreachable';
    err.transient = true;
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status >= 500 && attempt < 1) return googleTokenRequest(params, fetchImpl, attempt + 1);
    const code = json.error || 'google_token_failed';
    const err = new Error(code === 'invalid_grant' ? 'invalid_grant' : (json.error_description || code));
    err.code = code;
    if (code === 'invalid_grant') err.status = 401;
    else if (res.status >= 500) { err.status = 503; err.transient = true; err.message = 'google_unreachable'; }
    else err.status = res.status === 401 ? 401 : 400;
    throw err;
  }
  return json;
}

// Works with the drive.file scope; no extra consent is needed.
async function fetchDriveEmail(accessToken, fetchImpl = fetch) {
  if (!accessToken) return '';
  try {
    const res = await fetchImpl(ABOUT_URL, {
      headers: { Authorization: 'Bearer ' + accessToken },
      signal: timeoutSignal(GOOGLE_TIMEOUT_MS),
    });
    if (!res.ok) return '';
    const json = await res.json().catch(() => ({}));
    return String((json.user && json.user.emailAddress) || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function exchangeCode({ accountId, code, redirectUri, codeVerifier }, fetchImpl = fetch) {
  if (!isConfigured()) throw fail(503, 'google_oauth_not_configured');
  if (!code) throw fail(400, 'missing_code');
  if (!allowedRedirect(redirectUri)) throw fail(400, 'invalid_redirect_uri');
  const json = await googleTokenRequest({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  }, fetchImpl);
  if (json.refresh_token) persistRefresh(accountId, json.refresh_token, json.scope);
  else if (!readRefresh(accountId)) throw fail(400, 'no_refresh_token');
  if (!json.access_token) throw fail(400, 'no_access_token');
  const email = await fetchDriveEmail(json.access_token, fetchImpl);
  if (email) persistEmail(accountId, email);
  return {
    access_token: json.access_token,
    expires_in: Number(json.expires_in) || 3600,
    scope: json.scope || '',
    email: email || readEmail(accountId),
  };
}

async function refreshAccess(accountId, fetchImpl = fetch) {
  if (!isConfigured()) throw fail(503, 'google_oauth_not_configured');
  const refreshToken = readRefresh(accountId);
  if (!refreshToken) throw fail(404, 'not_connected');
  try {
    const json = await googleTokenRequest({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }, fetchImpl);
    if (json.refresh_token) persistRefresh(accountId, json.refresh_token, json.scope);
    if (!json.access_token) throw fail(400, 'no_access_token');
    let email = readEmail(accountId);
    if (!email) {
      email = await fetchDriveEmail(json.access_token, fetchImpl);
      if (email) persistEmail(accountId, email);
    }
    return {
      access_token: json.access_token,
      expires_in: Number(json.expires_in) || 3600,
      email,
    };
  } catch (err) {
    // Only a definitive answer from Google (revoked / expired grant) ends the
    // connection. Timeouts and 5xx keep the refresh token for the next try.
    if (err.code === 'invalid_grant') deleteRefresh(accountId);
    throw err;
  }
}

module.exports = {
  TOKEN_URL,
  clientId,
  isConfigured,
  resolveOauthAccountId,
  allowedRedirect,
  ensureGoogleDriveOauthSchema,
  persistRefresh,
  readRefresh,
  deleteRefresh,
  hasRefresh,
  readStatus,
  readEmail,
  persistEmail,
  fetchDriveEmail,
  googleTokenRequest,
  exchangeCode,
  refreshAccess,
};
