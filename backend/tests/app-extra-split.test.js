const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extraSource = fs.readFileSync(path.join(root, 'app-extra.js'), 'utf8');
const sessionsSource = fs.readFileSync(path.join(root, 'app-sessions.js'), 'utf8');
const financeSource = fs.readFileSync(path.join(root, 'app-finance.js'), 'utf8');
const todosSource = fs.readFileSync(path.join(root, 'app-todos.js'), 'utf8');

test('startup bundle defers sessions/finance/todos page parse', () => {
  assert.match(appSource, /function _tpEnsureChunk\(/);
  assert.match(appSource, /_tpLazyFor\('app-sessions\.js'/);
  assert.match(appSource, /_tpLazyFor\('app-finance\.js'/);
  assert.match(appSource, /_tpLazyFor\('app-todos\.js'/);
  assert.doesNotMatch(appSource, /async function renderSessions\(/);
  assert.doesNotMatch(appSource, /async function renderPayments\(/);
  assert.doesNotMatch(appSource, /function renderTodoList\(/);
  assert.doesNotMatch(appSource, /async function renderCalendar\(/);
  assert.match(sessionsSource, /async function renderSessions\(/);
  assert.match(financeSource, /async function renderPayments\(/);
  assert.match(todosSource, /function renderTodoList\(/);
  assert.match(todosSource, /async function renderCalendar\(/);
});

test('startup bundle defers dashboard/staff/knowledge/tutorial parse', () => {
  assert.match(appSource, /function _tpEnsureExtra\(/);
  assert.match(appSource, /\/app-extra\.js\?v=/);
  assert.doesNotMatch(appSource, /async function renderDashboard\(/);
  assert.doesNotMatch(appSource, /async function renderStaff\(/);
  assert.doesNotMatch(appSource, /async function renderInstructions\(/);
  assert.doesNotMatch(appSource, /async function renderTutorial\(/);
  assert.doesNotMatch(appSource, /function renderGoals\(/);
  assert.doesNotMatch(appSource, /function renderHabits\(/);
  assert.match(extraSource, /async function renderDashboard\(/);
  assert.match(extraSource, /async function renderStaff\(/);
  assert.match(extraSource, /async function renderInstructions\(/);
  assert.match(extraSource, /async function renderTutorial\(/);
  assert.match(extraSource, /function renderGoals\(/);
  assert.match(extraSource, /function renderHabits\(/);
});

test('first-session helpers stay in the core parse path', () => {
  assert.match(appSource, /function richToolbar\(/);
  assert.match(appSource, /function openEvaluation\(/);
  assert.match(appSource, /async function renderSettings\(/);
  assert.match(appSource, /function staffIsPersonnel\(/);
  assert.match(appSource, /function _goalsInit\(/);
  assert.match(appSource, /function _habitsInit\(/);
  assert.match(appSource, /function _ensureDocumentParts\(/);
  assert.match(appSource, /function _todoRenderedListHtml\(/);
});

test('staff delete records tombstones so sync cannot resurrect people', () => {
  assert.match(appSource, /function _recordStaffAndRelatedDeletions\(/);
  assert.match(appSource, /_recordStaffAndRelatedDeletions\(id\)/);
  assert.match(appSource, /_recordDeletedItems\('staff', ids\)/);
  assert.match(appSource, /_db\.staff=\(_db\.staff\|\|\[\]\)\.filter\(x=>String\(x\.id\)!==String\(id\)\)/);
  assert.match(appSource, /scalars\._deletedItems = data\._deletedItems/);
  assert.match(appSource, /function _mergeDeletedItemMaps\(/);
});

test('staff role rows all include add-item UI like bonus', () => {
  assert.match(extraSource, /function staffRoleRowHtml\(/);
  assert.match(extraSource, /class="role-row staff-items-row"/);
  assert.match(extraSource, /آیتم‌های \$\{escapeHtml\(role\.label\)\}/);
  assert.match(extraSource, /bonus_items: bonusItems\.length \? bonusItems : \[\{ amount: 0, note: '' \}\]/);
  assert.match(extraSource, /container\.insertAdjacentHTML\('beforeend', staffRoleRowHtml\(newRole/);
});

test('staff role occurrence count is editable, persisted, and included in totals', () => {
  assert.match(extraSource, /class="form-input role-count"[^>]*oninput="updateRoleRowTotal\(this\)"/);
  assert.doesNotMatch(extraSource, /class="form-input role-count"[^>]*readonly/);
  assert.match(extraSource, /const total = amountTotal \* countValue/);
  assert.match(extraSource, /count: Math\.max\(0, \+\(row\.querySelector\('\.role-count'\)\?\.value \|\| 0\)\)/);
});

test('customer account tab hosts the case financial table', () => {
  assert.match(financeSource, /_tpPaymentsTab\('families'\)">[^<]*حساب مشتری/);
  assert.doesNotMatch(financeSource, /_tpPaymentsTab\('families'\)">[^<]*حساب مشترک/);
  assert.match(appSource, /function studentAccountOverviewHtml\(/);
  assert.match(financeSource, /studentAccountOverviewHtml\(allStudents, filtered, \{/);
  assert.match(financeSource, /menuPrefix: 'acct'/);
  assert.match(appSource, /<th>پکیج‌ها<\/th>/);
  assert.match(appSource, /<th>مانده حساب<\/th>/);
  assert.match(appSource, /<th>وضعیت<\/th>/);
});

test('knowledge-center creates are confirmed across devices', () => {
  assert.match(appSource, /_save\(true, \{ urgent: true \}\); return _P\(\{ok:true, id\}\)/);
  assert.match(appSource, /function _mergeServerLoadedCollectionsIntoLocal\(/);
  assert.match(appSource, /_KNOWLEDGE_SESSION_REFRESH_KEYS/);
  assert.match(extraSource, /const syncResult = await _syncToServer\(\)/);
  assert.match(extraSource, /!_hasServerSyncPending\(\)/);
  assert.match(extraSource, /function _restoreInstrNavFromHash\(/);
  assert.match(extraSource, /function _instrSameParent\(/);
  assert.match(extraSource, /ذخیره و بین دستگاه‌ها همگام شد/);
});
