const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'gdrive-oauth-test-key';

const {
  PREFIX,
  isEncryptedSecret,
} = require('../utils/secretBox');
const oauth = require('../utils/googleDriveOauth');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const oauthJs = fs.readFileSync(path.join(root, 'oauth_callback.js'), 'utf8');

test('Drive refresh token is encrypted at rest', () => {
  const mem = new Database(':memory:');
  oauth.ensureGoogleDriveOauthSchema(mem);
  oauth.persistRefresh('acc1', 'refresh-plain-token', 'drive.file', mem);
  const raw = mem.prepare('SELECT refresh_token FROM google_drive_oauth WHERE account_id=?').get('acc1');
  assert.equal(isEncryptedSecret(raw.refresh_token), true);
  assert.equal(raw.refresh_token.startsWith(PREFIX), true);
  assert.equal(raw.refresh_token.includes('refresh-plain-token'), false);
  assert.equal(oauth.readRefresh('acc1', mem), 'refresh-plain-token');
  assert.equal(oauth.hasRefresh('acc1', mem), true);
  oauth.deleteRefresh('acc1', mem);
  assert.equal(oauth.hasRefresh('acc1', mem), false);
});

test('only TeamPulse oauth callback URLs are accepted', () => {
  assert.equal(oauth.allowedRedirect('https://teampulse.ir/oauth_callback.html'), true);
  assert.equal(oauth.allowedRedirect('https://evil.example/oauth_callback.html'), false);
  assert.equal(oauth.allowedRedirect('https://teampulse.ir/app'), false);
});

test('admin Drive oauth can target another account without dropping the admin token', () => {
  assert.equal(oauth.resolveOauthAccountId({ user: { id: 'admin', role: 'admin' }, query: { account_id: 'user-b' }, body: {} }), 'user-b');
  assert.equal(oauth.resolveOauthAccountId({ user: { id: 'admin', role: 'admin' }, query: {}, body: {} }), 'admin');
  assert.throws(
    () => oauth.resolveOauthAccountId({ user: { id: 'user-a', role: 'user' }, query: { account_id: 'user-b' }, body: {} }),
    (err) => err && err.status === 403
  );
  assert.match(app, /function _parkGoogleIntegrations\(/);
  assert.match(app, /async function _rebindGoogleIntegrations\(/);
  assert.match(app, /_parkGoogleIntegrations\(\)/);
  assert.match(app, /await _rebindGoogleIntegrations\(\)/);
  assert.doesNotMatch(app, /_gdrive\.disconnect\(\);[\s\S]{0,80}_loadImpersonatedAccountFromServer/);
  assert.match(app, /\/api\/google\/drive\/status' \+ _gdriveOauthQs\(\)/);
  assert.match(app, /\/api\/google\/drive' \+ _gdriveOauthQs\(\), \{ method: 'DELETE' \}/);
  assert.match(app, /deferIfImpersonating: true/);
  assert.match(app, /this\._suspended = true/);
});

test('boot and heartbeat never open the Google account picker', () => {
  const initStart = app.indexOf('async initOnLoad(');
  const initChunk = app.slice(initStart, initStart + 2200);
  assert.match(initChunk, /ensureToken\(false\)/);
  assert.doesNotMatch(initChunk, /ensureToken\(true/);
  const beatStart = app.indexOf('startHeartbeat()');
  const beatChunk = app.slice(beatStart, beatStart + 700);
  assert.match(beatChunk, /ensureToken\(false\)/);
  assert.doesNotMatch(beatChunk, /ensureToken\(true/);
  assert.match(app, /await this\.ensureToken\(false\);/);
  assert.match(app, /requestToken\(\{ consent: true \}\)/);
  assert.match(app, /response_type','code'/);
  assert.match(app, /\/api\/google\/drive\/refresh/);
  assert.match(serverJs, /app\.use\('\/api\/google'/);
  assert.match(oauthJs, /readParam\('code'\)/);
});
