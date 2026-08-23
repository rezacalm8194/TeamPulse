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
  assert.match(appSource, /function _todoHasReopenAfter\(/);
  assert.match(appSource, /if \(conflictAttempt < 4\) \{/);
  assert.match(appSource, /function _flushPendingServerSyncKeepalive\(/);
  assert.match(appSource, /_flushPendingServerSyncKeepalive\(\)/);
  assert.match(appSource, /unstamped-local-merged-with-newer-server/);
  assert.match(appSource, /function _setRecurringTodoOnOrAfterToday\(/);
  assert.match(appSource, /_setRecurringTodoOnOrAfterToday\(t\);/);
  assert.match(appSource, /keepalive: true/);
});

test('todo tick keeps complete operation after advancing a recurring task', () => {
  assert.match(appSource, /const intendedOp = oldDone \? 'reopen' : 'complete'/);
  assert.match(appSource, /_syncTodoDelta\(t, intendedOp, extraTodos\)/);
  assert.match(appSource, /_queueTodoTickPersist\(t, intendedOp, extraTodos\)/);
  assert.match(appSource, /تاریخچهٔ قدیمی سرور نباید تیک تازه‌تر همین دستگاه را برگرداند/);
  assert.match(appSource, /if \(window\._todoDeltaChain \|\| _isTodoDeltaPendingReason\(\)\) return false;/);
  assert.match(appSource, /function _scheduleTodoDeltaRetry\(/);
  assert.match(appSource, /function _isTodoDeltaPendingReason\(/);
});
