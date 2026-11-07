const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const oauthHtml = fs.readFileSync(path.join(root, 'oauth_callback.html'), 'utf8');
const oauthJs = fs.readFileSync(path.join(root, 'oauth_callback.js'), 'utf8');

test('Drive sync writes visible student and session files, not hidden appData', () => {
  assert.match(app, /SCOPE:\s*'https:\/\/www\.googleapis\.com\/auth\/drive\.file'/);
  assert.doesNotMatch(app, /spaces=appDataFolder/);
  assert.match(app, /function _gdriveStudentsCsv\(/);
  assert.match(app, /function _gdriveSessionsCsv\(/);
  assert.match(app, /لیست شاگردان\.csv/);
  assert.match(app, /فهرست جلسات\.csv/);
  assert.match(app, /id_شاگرد/);
  assert.match(app, /اتصال به Google Drive/);
  assert.match(app, /_gdrive\.connect\(APP_GOOGLE_CLIENT_ID\)/);
  assert.match(app, /this\.startHeartbeat\(\)/);
  assert.doesNotMatch(app, /پنجره ورود گوگل بسته شد و اتصال کامل نشد/);
  assert.match(app, /location\.origin\+'\/oauth_callback\.html'/);
  assert.match(app, /function _gdriveWriteSession\(/);
  assert.match(app, /tp_gdrive_session_/);
  assert.match(app, /await _gdrive\.initOnLoad\(\)/);
});

test('oauth callback script is external so server CSP can run it', () => {
  assert.doesNotMatch(oauthHtml, /<script>\s*\(/);
  assert.match(oauthHtml, /<script src="\/oauth_callback\.js\?v=tp\d+">/);
  assert.match(oauthJs, /access_token/);
  assert.match(oauthJs, /readParam\('code'\)/);
  assert.match(oauthJs, /teampulse_oauth_result_/);
  assert.match(oauthJs, /BroadcastChannel/);
});

test('student session csv keeps student identity columns', () => {
  const start = app.indexOf('function _gdriveSessionsCsv(');
  assert.ok(start >= 0);
  const chunk = app.slice(start, start + 1800);
  assert.match(chunk, /نام شاگرد/);
  assert.match(chunk, /تاریخ جلسه/);
  assert.match(chunk, /student_id/);
});
