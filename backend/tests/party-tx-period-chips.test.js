const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const finance = fs.readFileSync(path.join(root, 'app-finance.js'), 'utf8');

test('party tx period chips use data-period and event delegation', () => {
  assert.match(finance, /data-period="all"/);
  assert.match(finance, /function _ensurePartyTxPeriodDelegation/);
  assert.match(finance, /\.tx-period-chip\[data-period\]/);
  assert.doesNotMatch(finance, /onclick="setPartyTxPeriod\('all'\)"/);
  assert.match(finance, /console\.warn\('\[party-tx\]/);
});