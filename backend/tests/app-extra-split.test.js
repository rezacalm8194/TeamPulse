const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extraSource = fs.readFileSync(path.join(root, 'app-extra.js'), 'utf8');

test('startup bundle defers dashboard/staff/knowledge/tutorial parse', () => {
  assert.match(appSource, /function _tpEnsureExtra\(/);
  assert.match(appSource, /\/app-extra\.js\?v=/);
  assert.doesNotMatch(appSource, /async function renderDashboard\(/);
  assert.doesNotMatch(appSource, /async function renderStaff\(/);
  assert.doesNotMatch(appSource, /async function renderInstructions\(/);
  assert.doesNotMatch(appSource, /async function renderTutorial\(/);
  assert.match(extraSource, /async function renderDashboard\(/);
  assert.match(extraSource, /async function renderStaff\(/);
  assert.match(extraSource, /async function renderInstructions\(/);
  assert.match(extraSource, /async function renderTutorial\(/);
});

test('first-session helpers stay in the core parse path', () => {
  assert.match(appSource, /function richToolbar\(/);
  assert.match(appSource, /function openEvaluation\(/);
  assert.match(appSource, /async function renderSettings\(/);
  assert.match(appSource, /function staffIsPersonnel\(/);
});

test('staff role rows all include add-item UI like bonus', () => {
  assert.match(extraSource, /function staffRoleRowHtml\(/);
  assert.match(extraSource, /class="role-row staff-items-row"/);
  assert.match(extraSource, /آیتم‌های \$\{escapeHtml\(role\.label\)\}/);
  assert.match(extraSource, /bonus_items: bonusItems\.length \? bonusItems : \[\{ amount: 0, note: '' \}\]/);
  assert.match(extraSource, /container\.insertAdjacentHTML\('beforeend', staffRoleRowHtml\(newRole/);
});

test('customer account tab hosts the case financial table', () => {
  assert.match(appSource, /_tpPaymentsTab\('families'\)">[^<]*حساب مشتری/);
  assert.doesNotMatch(appSource, /_tpPaymentsTab\('families'\)">[^<]*حساب مشترک/);
  assert.match(appSource, /function studentAccountOverviewHtml\(/);
  assert.match(appSource, /studentAccountOverviewHtml\(allStudents, filtered, \{ showSessions: false, menuPrefix: 'acct' \}\)/);
  assert.match(appSource, /<th>پکیج‌ها<\/th>/);
  assert.match(appSource, /<th>مانده حساب<\/th>/);
  assert.match(appSource, /<th>وضعیت<\/th>/);
});
