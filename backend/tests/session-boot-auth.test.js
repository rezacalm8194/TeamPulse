const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('boot refreshes the JWT before workspace GETs so Chrome does not log 401 storms', () => {
  const init = app.slice(app.indexOf('async function _initAuth()'), app.indexOf('// TODO LIST'));
  assert.match(init, /const ok = await _authEnsureLiveSession\(saved\)/);
  assert.match(init, /if \(!ok\)/);
  const afterEnsure = init.slice(init.indexOf('_authEnsureLiveSession'));
  assert.match(afterEnsure, /await _authOnSuccess\(\)/);
  assert.ok(
    afterEnsure.indexOf('_authEnsureLiveSession') < afterEnsure.indexOf('await _authOnSuccess()'),
    'workspace load must wait for a live session'
  );
  assert.doesNotMatch(init, /verify token در پس‌زمینه/);
  const ensure = app.slice(app.indexOf('async function _authEnsureLiveSession'), app.indexOf('async function _apiFetch'));
  assert.match(ensure, /_authTrySavedCredentialLogin\(\)/);
  assert.doesNotMatch(ensure, /_authOnSuccess/);
  assert.match(app, /_apiFetch\('\/api\/auth\/me',\s*\{\s*skipAuthRecover:\s*true/);
});

test('status polling does not fetch while the browser reports offline', () => {
  assert.match(app, /function _tpBrowserOffline\(/);
  assert.match(app, /navigator\.onLine === false/);
  assert.match(app, /window\.addEventListener\('offline'/);
  const poll = app.slice(app.indexOf('async function _pollServerStatus()'), app.indexOf('function _refreshUiAfterServerLoad'));
  assert.match(poll, /if \(_tpBrowserOffline\(\)\)/);
  const fetchFn = app.slice(app.indexOf('async function _apiFetch('), app.indexOf('async function _compressedJsonRequestBody'));
  assert.match(fetchFn, /if \(_tpBrowserOffline\(\)\)/);
  assert.doesNotMatch(fetchFn, /if \(!isNetwork && url !== publicUrl\)[\s\S]{0,40}if \(!isNetwork && url !== publicUrl\)/);
});
