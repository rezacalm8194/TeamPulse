// «موارد بیشتر» in the customer-account tabs: renderPayments owns the
// show-more counter key (search + filters). The embedded inner renderers
// (reminders, families) must not re-sync it with a different key, or the
// counter resets to the first chunk on every render and the button does
// nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const finance = fs.readFileSync(path.join(root, 'app-finance.js'), 'utf8').replace(/\r\n/g, '\n');

test('embedded reminders render does not reset the show-more counter', () => {
  assert.match(finance, /async function renderReminders\(search = '', embedded = false, contentPrefix = ''\) \{[\s\S]{0,200}if \(!embedded\) _syncPaymentsListShown\('reminders', search\);/);
});

test('embedded families render does not re-sync the counter', () => {
  const start = finance.indexOf('async function renderFamilies(');
  const body = finance.slice(start, finance.indexOf('\nasync function ', start + 10));
  assert.doesNotMatch(body, /_syncPaymentsListShown\('families'/);
});

test('renderPayments still syncs with the full key', () => {
  assert.match(finance, /_syncPaymentsListShown\(tab, `\$\{search\}\\x1e\$\{view\.studentId \|\| ''\}\\x1e\$\{view\.range \|\| 'all'\}`\);/);
});
