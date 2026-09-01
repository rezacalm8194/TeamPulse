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
  assert.match(appSource, /function _documentHasUnloadedParts\(/);
  assert.match(appSource, /function _ensureDocumentParts\(/);
  assert.match(appSource, /_documentIncludeQuery\(/);
});

test('todo completion merge prefers done state and later recurring dates', () => {
  assert.match(appSource, /function _pickMergedTodo\(/);
  assert.match(appSource, /function _todoRemoteDateRegressesLocal\(/);
  assert.match(appSource, /if \(conflictAttempt < 4\) \{/);
  assert.match(appSource, /function _flushPendingServerSyncKeepalive\(/);
  assert.match(appSource, /_flushPendingServerSyncKeepalive\(\)/);
  assert.match(appSource, /unstamped-local-merged-with-newer-server/);
  assert.match(appSource, /forceStaffLive/);
  assert.match(appSource, /function _todoCatchUpDateOnOrAfterToday\(/);
  assert.match(appSource, /function _setRecurringTodoOnOrAfterToday\(/);
  assert.match(appSource, /_setRecurringTodoOnOrAfterToday\(t\);/);
  assert.match(appSource, /if \(scheduledKey && scheduledKey < todayKey\) \{[\s\S]*?_setRecurringTodoOnOrAfterToday\(t\);/);
  assert.doesNotMatch(appSource, /_advanceTodoDate\(t, _todayJalaliStr\(\)\)/);
  assert.match(appSource, /function _todoHasCatchUpOnScheduledDay\(/);
  assert.match(appSource, /if \(taskKey && taskKey < todayKey\) return _todoCatchUpDateOnOrAfterToday\(t\)/);
  assert.match(appSource, /keepalive: true/);
});

test('todo tick keeps complete operation after advancing a recurring task', () => {
  assert.match(appSource, /const intendedOp = oldDone \? 'reopen' : 'complete'/);
  assert.match(appSource, /_syncTodoDelta\(t, intendedOp, extraTodos\)/);
  assert.match(appSource, /_queueTodoTickPersist\(t, intendedOp, extraTodos\)/);
  assert.match(appSource, /تاریخچهٔ قدیمی سرور نباید تیک تازه‌تر همین دستگاه را برگرداند/);
  assert.match(appSource, /window\._todoDeltaChain \|\| _isTodoDeltaPendingReason\(\)/);
  assert.match(appSource, /function _scheduleTodoDeltaRetry\(/);
  assert.match(appSource, /function _isTodoDeltaPendingReason\(/);
  assert.match(appSource, /function _enqueueDurableTodoDelta\(/);
  assert.match(appSource, /function _drainDurableTodoDeltaQueue\(/);
  assert.match(appSource, /function _flushPendingLocalWritesOnResume\(/);
  assert.match(appSource, /await _flushPendingLocalWritesOnResume\(\)/);
  assert.match(appSource, /todo-delta-save/);
  assert.match(appSource, /urgent\s*[:=]\s*true/);
});

test('complete todo deletion syncs through todo delta instead of a full document save', () => {
  assert.match(appSource, /_syncTodoDelta\(t, 'delete', removedTodos\)/);
  assert.match(appSource, /operation === 'complete' \|\| operation === 'reopen' \|\| operation === 'delete'/);
});

test('invited teammates keep pending archive student changes until they persist', () => {
  assert.match(appSource, /function _teamCanWriteOwnerStudents\(/);
  assert.match(appSource, /_TEAM_STUDENT_PENDING_KEYS/);
  assert.match(appSource, /allowLocal && localTime === serverTime/);
  assert.match(appSource, /_save\(true,\{urgent:true\}\)/);
});

test('mobile resume flushes local writes before polling the server', () => {
  assert.match(appSource, /async function _syncFromServerOnResume\(/);
  assert.match(appSource, /await _flushPendingLocalWritesOnResume\(\)/);
  assert.match(appSource, /await _pollServerStatus\(\)/);
  assert.match(appSource, /resume-flush/);
  assert.match(appSource, /onlyTodosChanged/);
});

test('nested knowledge hashes restore the same folder on phone and laptop', () => {
  assert.match(appSource, /function _parseAppHash\(/);
  assert.match(appSource, /_parseAppHash\(\)\.page/);
  assert.match(appSource, /_invalidateUnfetchedDocumentParts\(/);
  assert.match(appSource, /function _mergeBusinessRow\(/);
  assert.match(appSource, /function _keepLocalBusinessRow\(/);
  assert.match(appSource, /reset \|\| !_tpPartLoaded\(collection\)/);
  assert.match(appSource, /case_forms', 'key_events', 'topics'/);
});

test('knowledge items created on another device are merged even when local data looks newer', () => {
  assert.match(appSource, /function _mergeServerLoadedCollectionsIntoLocal\(/);
  assert.match(appSource, /let changed = _mergeServerLoadedCollectionsIntoLocal\(serverData\)/);
  assert.match(appSource, /_KNOWLEDGE_SESSION_REFRESH_KEYS/);
  assert.match(appSource, /_tpSessionFetchedParts/);
  assert.match(appSource, /partsWereFullyLoaded/);
});

test('customer affairs refresh keeps unsynced local rows during partial server load', () => {
  assert.match(appSource, /const localBeforeLoad = _db && typeof _db === 'object' \? _cloneData\(_db\) : null/);
  assert.match(appSource, /preserveLocalBusiness/);
  assert.match(appSource, /reset: !preserveLocalBusiness/);
  assert.match(appSource, /target\[key\] = _mergeIdList\(target\[key\], serverVal\)/);
  assert.match(appSource, /'guide_categories','guide_items','case_forms','todos'/);
  assert.match(appSource, /localBeforeLoad\?\.case_forms\?\.length/);
  assert.match(appSource, /function _mergeLocalBusinessCollections\(/);
  assert.match(appSource, /function _flushInteractiveSessionNoteSave\(/);
  assert.match(appSource, /baselineHash && baselineHash !== _isolationItemHash\(row\)/);
});