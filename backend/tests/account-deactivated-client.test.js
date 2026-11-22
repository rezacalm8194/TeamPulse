const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');

test('deactivated account handling stops sync without wiping local workspace', () => {
  assert.match(app, /async function _tpHandleAccountDeactivated\(/);
  assert.match(app, /window\._tpAccountDeactivated = true/);
  assert.match(app, /_tpMaybeHandleAccountDeactivated/);
  assert.match(app, /error !== 'account_deactivated'/);
  assert.doesNotMatch(
    app.slice(app.indexOf('async function _tpHandleAccountDeactivated'), app.indexOf('async function _tpHandleUnauthorized')),
    /_resetWorkspaceAfterIdentityChange/
  );
});

test('sync loops bail out while account is deactivated', () => {
  assert.match(app, /async function _syncToServer[\s\S]{0,220}?if \(window\._tpAccountDeactivated\) return null/);
  assert.match(app, /async function _loadFromServerImpl[\s\S]{0,220}?if \(window\._tpAccountDeactivated\) return false/);
});

test('successful auth clears the deactivated flag', () => {
  assert.match(app, /async function _authOnSuccess\(\) \{\s*window\._tpAccountDeactivated = false;/s);
});