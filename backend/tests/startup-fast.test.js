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

test('CSP blocks inline scripts, not the UI styles the app still renders', () => {
  assert.doesNotMatch(appHtml, /script-src [^;]*'unsafe-inline'/);
  assert.match(appHtml, /style-src 'self' 'unsafe-inline' https:/);
  assert.doesNotMatch(appHtml, /<style>/);
  assert.doesNotMatch(appHtml, /<script>/);
  assert.match(appHtml, /<script src="\/tp-inline-bind\.js/);
  const serverScriptSrc = serverJs.match(/"script-src[^"]+"/);
  assert.ok(serverScriptSrc);
  assert.doesNotMatch(serverScriptSrc[0], /unsafe-inline/);
  assert.match(serverJs, /style-src 'self' 'unsafe-inline' https:/);
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

test('desktop push uses PNG assets and in-app fallback', () => {
  const swJs = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const remindersJs = fs.readFileSync(path.join(root, 'backend', 'routes', 'reminders.js'), 'utf8');
  assert.match(swJs, /NOTIFICATION_ICON = new URL\('\/app-icon-192-v3\.png'/);
  assert.match(swJs, /NOTIFICATION_BADGE = new URL\('\/notification-badge\.png'/);
  assert.match(swJs, /type: 'PUSH_RECEIVED'/);
  assert.match(swJs, /hasFocusedAppWindow/);
  assert.match(swJs, /if \(!appInForeground\)/);
  assert.doesNotMatch(swJs, /notification-badge\.svg/);
  assert.doesNotMatch(swJs, /NOTIFICATION_BADGE = NOTIFICATION_ICON/);
  assert.match(appJs, /_showLaptopPushEnableBanner/);
  assert.match(appJs, /_appWindowIsForeground/);
  assert.match(remindersJs, /badge: '\/notification-badge\.png'/);
  assert.match(remindersJs, /urgency: 'high'/);
  assert.equal(fs.existsSync(path.join(root, 'notification-badge.png')), true);
});
