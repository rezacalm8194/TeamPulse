const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('dashboard staff alerts treat reminder payments as settled, not only monthly.paid', () => {
  assert.match(app, /function _staffReminderSettlement\(/);
  assert.match(app, /settledByPayments = expectedAmount > 0 && paidAmount >= expectedAmount/);
  const stats = app.match(/dashboard:\s*\{[\s\S]*?staffPaymentAlerts=[\s\S]*?\.sort\(/)?.[0] || '';
  assert.match(stats, /_staffReminderSettlement\(r\)/);
  assert.match(stats, /!item\.settled&&item\.amount>0/);
  assert.doesNotMatch(stats, /paidForDueMonth&&item\.dueIn/);
});

test('dashboard document parts include staff payments used to settle salary follow-ups', () => {
  const dashboardParts = app.match(/dashboard:\s*\[([^\]]+)\]/)?.[1] || '';
  assert.match(dashboardParts, /'staff_payments'/);
  assert.match(dashboardParts, /'staff_reminders'/);
  assert.match(dashboardParts, /'staff_monthly'/);
});
