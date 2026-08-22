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

test('gzip compression is enabled for static assets', () => {
  assert.match(serverJs, /require\('compression'\)/);
  assert.match(serverJs, /app\.use\(compression\(/);
  assert.match(serverJs, /max-age=31536000, immutable/);
});

test('workspace registry sync is not on the first-paint path', () => {
  const auth = appJs.slice(appJs.indexOf('async function _authOnSuccess()'), appJs.indexOf('await init();'));
  assert.match(auth, /await _loadPrimaryDatabase\(\)/);
  assert.doesNotMatch(auth, /await _refreshWorkspacesFromServer\(\)/);
});
