const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'gdrive-stable-test-key';
const oauth = require('../utils/googleDriveOauth');
const app = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app.js'), 'utf8');
const ok = (json) => ({ ok: true, status: 200, json: async () => json });

test('connected Gmail is stored and reported; legacy table gets email column', async () => {
  const mem = new Database(':memory:');
  mem.prepare('CREATE TABLE google_drive_oauth (account_id TEXT PRIMARY KEY, refresh_token TEXT NOT NULL, scope TEXT, updated_at INTEGER)').run();
  oauth.ensureGoogleDriveOauthSchema(mem);
  oauth.persistRefresh('a', 'rt', 'drive.file', mem);
  oauth.persistEmail('a', 'Coach@Gmail.com', mem);
  assert.deepEqual(oauth.readStatus('a', mem), { connected: true, email: 'coach@gmail.com', undecryptable: false });
  assert.equal(await oauth.fetchDriveEmail('tok', async () => ok({ user: { emailAddress: 'X@gmail.com' } })), 'x@gmail.com');
  mem.prepare("UPDATE google_drive_oauth SET refresh_token='tp1.bad.bad.bad'").run();
  assert.equal(oauth.readStatus('a', mem).connected, false);
});

test('network failures are transient (503) and retried; invalid_grant is definitive', async () => {
  let calls = 0;
  await assert.rejects(
    oauth.googleTokenRequest({}, async () => { calls++; throw new Error('ECONNRESET'); }),
    (e) => e.status === 503 && e.transient === true && e.message === 'google_unreachable'
  );
  assert.equal(calls, 2);
  await assert.rejects(
    oauth.googleTokenRequest({}, async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) })),
    (e) => e.status === 401 && e.message === 'invalid_grant'
  );
});

test('client only disconnects on a definitive server answer and shows the Gmail', () => {
  assert.match(app, /_lastRefreshFatal = res\.status === 404/);
  assert.match(app, /else if \(this\._lastRefreshFatal\)/);
  assert.match(app, /checkServerStatus\(\)/);
  assert.match(app, /id="gdrive-account"/);
  assert.match(app, /متصل به: /);
  assert.match(app, /_gdrive\.refreshAccountUI\(\)/);
  // a failed status call must not downgrade to the 1-hour implicit flow
  assert.doesNotMatch(app, /this\._oauthReady = false;/);
});
