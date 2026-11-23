const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function assertTpAssetVersionsAligned(root) {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const m = app.match(/const TP_ASSET_V = '(tp[a-f0-9]{10})'/);
  assert.ok(m, 'TP_ASSET_V must be tp + 10 hex chars from bump-asset-version.js');
  const v = m[1];
  const cacheSuffix = v.replace(/^tp/, '');
  assert.match(sw, new RegExp(`const CACHE = 'team-pulse-static-v${cacheSuffix}'`));
  assert.match(html, new RegExp(`/app\\.js\\?v=${v}`));
  assert.match(html, new RegExp(`/app\\.css\\?v=${v}`));
  assert.match(html, /Vazirmatn-Regular\.woff2\?v=tp402/);
  return v;
}

module.exports = { assertTpAssetVersionsAligned };