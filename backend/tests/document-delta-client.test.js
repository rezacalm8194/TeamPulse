const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app.html'), 'utf8');

test('ordinary workspace syncs send collection deltas instead of the full account document', () => {
  assert.match(appSource, /function _buildServerSyncPatch\(/);
  assert.match(appSource, /function _preferDocumentDelta\(/);
  assert.match(appSource, /\/delta' \+ _workspaceQuery\(\)/);
  assert.match(appSource, /hashes,/);
});
