// Persistent (refresh-token) login for Google Calendar, mirroring the Drive
// flow in googleDriveOauth.js. Kept in its own table so connecting or
// disconnecting Calendar never touches the Drive connection.
const db = require('../config/database');
const { encryptSecret, decryptSecret } = require('./secretBox');
const drive = require('./googleDriveOauth');

const PRIMARY_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList/primary?fields=id';

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function ensureGoogleCalendarOauthSchema(database = db) {
  database.prepare(`
    CREATE TABLE IF NOT EXISTS google_calendar_oauth (
      account_id TEXT PRIMARY KEY,
      refresh_token TEXT NOT NULL,
      scope TEXT,
      email TEXT,
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `).run();
}

function persistRefresh(accountId, refreshToken, scope, database = db) {
  if (!accountId || !refreshToken) return;
  ensureGoogleCalendarOauthSchema(database);
  database.prepare(`
    INSERT INTO google_calendar_oauth (account_id, refresh_token, scope, updated_at)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(account_id) DO UPDATE SET
      refresh_token=excluded.refresh_token,
      scope=COALESCE(excluded.scope, google_calendar_oauth.scope),
      updated_at=excluded.updated_at
  `).run(accountId, encryptSecret(refreshToken), scope || null);
}

function persistEmail(accountId, email, database = db) {
  const value = String(email || '').trim().toLowerCase();
  if (!accountId || !value) return;
  ensureGoogleCalendarOauthSchema(database);
  database.prepare('UPDATE google_calendar_oauth SET email=? WHERE account_id=?').run(value, accountId);
}

function readRefresh(accountId, database = db) {
  ensureGoogleCalendarOauthSchema(database);
  const row = database.prepare('SELECT refresh_token FROM google_calendar_oauth WHERE account_id=?').get(accountId);
  return row ? decryptSecret(row.refresh_token) : '';
}

function readEmail(accountId, database = db) {
  ensureGoogleCalendarOauthSchema(database);
  const row = database.prepare('SELECT email FROM google_calendar_oauth WHERE account_id=?').get(accountId);
  return (row && row.email) || '';
}

function readStatus(accountId, database = db) {
  ensureGoogleCalendarOauthSchema(database);
  const row = database.prepare('SELECT refresh_token, email FROM google_calendar_oauth WHERE account_id=?').get(accountId);
  if (!row) return { connected: false, email: '', undecryptable: false };
  const plain = decryptSecret(row.refresh_token);
  return { connected: !!plain, email: row.email || '', undecryptable: !plain };
}

function deleteRefresh(accountId, database = db) {
  ensureGoogleCalendarOauthSchema(database);
  database.prepare('DELETE FROM google_calendar_oauth WHERE account_id=?').run(accountId);
}

// The primary calendar's id is the account's Gmail address
// (needs only calendar.calendarlist.readonly, which we already request).
async function fetchCalendarEmail(accessToken, fetchImpl = fetch) {
  if (!accessToken) return '';
  try {
    const res = await fetchImpl(PRIMARY_URL, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!res.ok) return '';
    const json = await res.json().catch(() => ({}));
    const id = String(json.id || '').trim().toLowerCase();
    return id.includes('@') ? id : '';
  } catch (e) {
    return '';
  }
}

async function exchangeCode({ accountId, code, redirectUri, codeVerifier }, fetchImpl = fetch) {
  if (!drive.isConfigured()) throw fail(503, 'google_oauth_not_configured');
  if (!code) throw fail(400, 'missing_code');
  if (!drive.allowedRedirect(redirectUri)) throw fail(400, 'invalid_redirect_uri');
  const json = await drive.googleTokenRequest({
    client_id: drive.clientId(),
    client_secret: String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim(),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  }, fetchImpl);
  if (json.refresh_token) persistRefresh(accountId, json.refresh_token, json.scope);
  else if (!readRefresh(accountId)) throw fail(400, 'no_refresh_token');
  if (!json.access_token) throw fail(400, 'no_access_token');
  const email = await fetchCalendarEmail(json.access_token, fetchImpl);
  if (email) persistEmail(accountId, email);
  return {
    access_token: json.access_token,
    expires_in: Number(json.expires_in) || 3600,
    scope: json.scope || '',
    email: email || readEmail(accountId),
  };
}

async function refreshAccess(accountId, fetchImpl = fetch) {
  if (!drive.isConfigured()) throw fail(503, 'google_oauth_not_configured');
  const refreshToken = readRefresh(accountId);
  if (!refreshToken) throw fail(404, 'not_connected');
  try {
    const json = await drive.googleTokenRequest({
      client_id: drive.clientId(),
      client_secret: String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }, fetchImpl);
    if (json.refresh_token) persistRefresh(accountId, json.refresh_token, json.scope);
    if (!json.access_token) throw fail(400, 'no_access_token');
    let email = readEmail(accountId);
    if (!email) {
      email = await fetchCalendarEmail(json.access_token, fetchImpl);
      if (email) persistEmail(accountId, email);
    }
    return {
      access_token: json.access_token,
      expires_in: Number(json.expires_in) || 3600,
      scope: json.scope || '',
      email,
    };
  } catch (err) {
    // Only a definitive "revoked/expired" from Google ends the connection.
    if (err.code === 'invalid_grant') deleteRefresh(accountId);
    throw err;
  }
}

module.exports = {
  ensureGoogleCalendarOauthSchema,
  persistRefresh,
  persistEmail,
  readRefresh,
  readEmail,
  readStatus,
  deleteRefresh,
  fetchCalendarEmail,
  exchangeCode,
  refreshAccess,
};
