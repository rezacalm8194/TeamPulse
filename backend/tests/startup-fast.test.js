const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const appHtml = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');

test('app shell does not prefetch extra JS on first paint', () => {
  assert.doesNotMatch(appHtml, /rel="prefetch"[^>]*app-extra/);
  assert.match(appHtml, /family=Vazirmatn:wght@400;600/);
  assert.doesNotMatch(appHtml, /wght@300;400;500;600;700/);
});

test('CSP does not allow unsafe-inline for scripts or styles', () => {
  assert.doesNotMatch(appHtml, /unsafe-inline/);
  assert.doesNotMatch(appHtml, /<style>/);
  assert.doesNotMatch(appHtml, /<script>/);
  assert.match(appHtml, /<script src="\/tp-inline-bind\.js/);
  assert.doesNotMatch(serverJs, /'unsafe-inline'/);
  assert.equal(fs.existsSync(path.join(root, 'tp-inline-bind.js')), true);
});

test('gzip compression is enabled for static assets', () => {
  assert.match(serverJs, /require\('compression'\)/);
  assert.match(serverJs, /compression_unavailable/);
  assert.match(serverJs, /max-age=31536000, immutable/);
});

test('student form interpolates stored fields through escapeHtml', () => {
  assert.match(appJs, /id="f-name"[^>]*value="\$\{escapeHtml\(s\?\.name/);
  assert.match(appJs, /id="f-note"[^]*\$\{escapeHtml\(s\?\.note/);
  assert.doesNotMatch(appJs, /value="\$\{s\?\.name \|\| ''\}"/);
});

test('workspace registry sync is not on the first-paint path', () => {
  const auth = appJs.slice(appJs.indexOf('async function _authOnSuccess()'), appJs.indexOf('await init();'));
  assert.match(auth, /await _loadPrimaryDatabase\(\)/);
  assert.doesNotMatch(auth, /await _refreshWorkspacesFromServer\(\)/);
});
