const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app.js'), 'utf8');

test('ordinary workspace syncs send collection deltas instead of the full account document', () => {
  assert.match(appSource, /function _buildServerSyncPatch\(/);
  assert.match(appSource, /function _preferDocumentDelta\(/);
  assert.match(appSource, /\/delta' \+ _workspaceQuery\(\)/);
  assert.match(appSource, /hashes,/);
});

test('todo completion merge prefers done state and later recurring dates', () => {
  assert.match(appSource, /function _pickMergedTodo\(/);
  assert.match(appSource, /function _flushPendingServerSyncKeepalive\(/);
  assert.match(appSource, /_flushPendingServerSyncKeepalive\(\)/);
  assert.match(appSource, /unstamped-local-merged-with-newer-server/);
  assert.match(appSource, /while \(_jalaliKey\(t\.date_jalali \|\| ''\) < todayKey/);
});
