const db = require('../config/database');
const { encryptSecret, decryptSecret } = require('./secretBox');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
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

async function googleTokenRequest(params, fetchImpl = fetch) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || 'google_token_failed');
    err.status = res.status === 401 ? 401 : 400;
    err.code = json.error || 'google_token_failed';
    throw err;
  }
  return json;
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
  return {
    access_token: json.access_token,
    expires_in: Number(json.expires_in) || 3600,
    scope: json.scope || '',
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
    return {
      access_token: json.access_token,
      expires_in: Number(json.expires_in) || 3600,
    };
  } catch (err) {
    if (err.code === 'invalid_grant') deleteRefresh(accountId);
    throw err;
  }
}

module.exports = {
  TOKEN_URL,
  clientId,
  isConfigured,
  allowedRedirect,
  ensureGoogleDriveOauthSchema,
  persistRefresh,
  readRefresh,
  deleteRefresh,
  hasRefresh,
  exchangeCode,
  refreshAccess,
};
