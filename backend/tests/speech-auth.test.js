const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const speech = fs.readFileSync(path.join(__dirname, '../routes/speech.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  assert.ok(end > start, `missing ${endNeedle} after ${startNeedle}`);
  return src.slice(start, end);
}

test('speech ping, health, and debug audio sit behind router.use(auth)', () => {
  const authAt = speech.indexOf('router.use(auth)');
  const pingAt = speech.indexOf("router.get('/ping'");
  const healthAt = speech.indexOf("router.get('/health'");
  const debugAt = speech.indexOf("router.get('/debug-last-audio'");
  const transcribeAt = speech.indexOf("router.post('/transcribe'");
  assert.ok(authAt >= 0, 'speech router must apply auth globally');
  assert.ok(authAt < pingAt && authAt < healthAt && authAt < debugAt && authAt < transcribeAt);
  assert.match(speech, /router\.post\('\/transcribe'.*\bauth\b/);
});

test('speech health GET does not start the Vosk worker', () => {
  const health = sliceBetween(speech, "router.get('/health'", 'function speechRouteHit');
  assert.equal(health.includes('startVoskWorker'), false);
});

test('client speech debug probes send Authorization and do not use unauthenticated audio URLs', () => {
  assert.match(app, /_apiFetch\('\/api\/speech\/ping'/);
  assert.match(app, /_apiFetch\('\/api\/speech\/health'/);
  assert.match(app, /_apiFetch\(path,\s*\{\s*method:\s*'GET',\s*headers\s*\}/);
  assert.match(app, /\/api\/speech\/debug-last-audio/);
  assert.doesNotMatch(app, /new Audio\(url \+/);
  assert.match(app, /function _voiceSpeechAuthHeaders/);
});
