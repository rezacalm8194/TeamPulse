const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { configureWebPush, readVapidKeys, VAPID_MAILTO } = require('../utils/vapid');

test('empty VAPID keys do not throw and skip setVapidDetails', () => {
  const calls = [];
  const fake = { setVapidDetails(...args) { calls.push(args); } };
  const logs = [];
  const ok = configureWebPush(fake, { VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '  ' }, {
    warn: (event) => logs.push(event),
  });
  assert.equal(ok, false);
  assert.equal(calls.length, 0);
  assert.deepEqual(logs, ['vapid_keys_missing']);
  assert.equal(readVapidKeys({}).configured, false);
});

test('valid VAPID keys are applied once', () => {
  const keys = webpush.generateVAPIDKeys();
  const calls = [];
  const fake = { setVapidDetails(...args) { calls.push(args); } };
  const ok = configureWebPush(fake, {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [VAPID_MAILTO, keys.publicKey, keys.privateKey]);
});

test('malformed VAPID keys do not throw at configure time', () => {
  const logs = [];
  const ok = configureWebPush(webpush, {
    VAPID_PUBLIC_KEY: 'not-a-key',
    VAPID_PRIVATE_KEY: 'also-not-a-key',
  }, {
    warn: (event, fields) => logs.push({ event, fields }),
  });
  assert.equal(ok, false);
  assert.equal(logs[0]?.event, 'vapid_keys_invalid');
});

test('boot routes guard VAPID instead of calling setVapidDetails at load', () => {
  const reminders = fs.readFileSync(path.join(__dirname, '..', 'routes', 'reminders.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  assert.match(reminders, /configureWebPush\(webpush/);
  assert.match(admin, /configureWebPush\(webpush/);
  assert.doesNotMatch(reminders, /webpush\.setVapidDetails\(/);
  assert.doesNotMatch(admin, /webpush\.setVapidDetails\(/);
});
