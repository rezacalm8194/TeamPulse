const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'gcal-oauth-test-key';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'test-secret';
const { isEncryptedSecret } = require('../utils/secretBox');
const gcal = require('../utils/googleCalendarOauth');
const app = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app.js'), 'utf8');
const routes = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'google.js'), 'utf8');
const ok = (json) => ({ ok: true, status: 200, json: async () => json });

test('Calendar refresh token is encrypted, separate from Drive, and reports the Gmail', () => {
  const mem = new Database(':memory:');
  gcal.ensureGoogleCalendarOauthSchema(mem);
  gcal.persistRefresh('a', 'cal-refresh', 'calendar.events', mem);
  gcal.persistEmail('a', 'Coach@Gmail.com', mem);
  const raw = mem.prepare('SELECT refresh_token FROM google_calendar_oauth WHERE account_id=?').get('a');
  assert.equal(isEncryptedSecret(raw.refresh_token), true);
  assert.equal(gcal.readRefresh('a', mem), 'cal-refresh');
  assert.deepEqual(gcal.readStatus('a', mem), { connected: true, email: 'coach@gmail.com', undecryptable: false });
  gcal.deleteRefresh('a', mem);
  assert.equal(gcal.readStatus('a', mem).connected, false);
});

test('Calendar email comes from the primary calendar id', async () => {
  assert.equal(await gcal.fetchCalendarEmail('t', async () => ok({ id: 'Me@Gmail.com' })), 'me@gmail.com');
  assert.equal(await gcal.fetchCalendarEmail('t', async () => ok({ id: 'not-an-email' })), '');
});

test('Calendar routes and client use the persistent login like Drive', () => {
  assert.match(routes, /router\.get\('\/calendar\/status'/);
  assert.match(routes, /router\.post\('\/calendar\/refresh'/);
  assert.match(routes, /router\.post\('\/calendar\/exchange'/);
  assert.match(routes, /router\.delete\('\/calendar'/);
  assert.match(app, /\/api\/google\/calendar\/refresh/);
  assert.match(app, /id="gcal-account"/);
  assert.match(app, /_gcal\.refreshAccountUI\(\)/);
  assert.match(app, /await this\.backgroundToken\(\)/);
  assert.match(app, /await _gcal\.initOnLoad\(\)/);
});
