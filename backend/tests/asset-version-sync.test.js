const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertTpAssetVersionsAligned } = require('./tp-asset-version');

const root = path.resolve(__dirname, '../..');

test('TP_ASSET_V matches app.html and sw.js cache', () => {
  assertTpAssetVersionsAligned(root);
});

test('bump-asset-version.js derives version from bundle hashes', () => {
  const bump = require(path.join(root, 'scripts', 'bump-asset-version.js'));
  const v = bump.contentVersion();
  assert.match(v, /^tp[a-f0-9]{10}$/);
});