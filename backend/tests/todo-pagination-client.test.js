const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('client loads todos from the paginated endpoint instead of document include', () => {
  assert.match(app, /TODO_SERVER_PAGE_SIZE\s*=\s*200/);
  assert.match(app, /'\/todos'\s*\+\s*query/);
  assert.match(app, /&order=updated/);
  assert.match(app, /BUSINESS_PAGINATED_KEYS/);
  assert.match(app, /!BUSINESS_PAGINATED_KEYS\.includes\(key\)/);
  const core = app.match(/const _CORE_DOCUMENT_PARTS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(core, /'todos'/);
  assert.doesNotMatch(core, /'packages'/);
});

test('client loads business collections from paginated endpoints', () => {
  assert.match(app, /BUSINESS_SERVER_PAGE_SIZE\s*=\s*200/);
  assert.match(app, /function _ensureBusinessPartLoaded\(/);
  assert.match(app, /function _loadMoreBusiness\(/);
  assert.match(app, /'packages', 'families', 'reminders', 'expenses', 'wallet_tx'/);
});

test('financial surfaces fully hydrate paginated data before rendering totals and rows', () => {
  const extra = fs.readFileSync(path.join(root, 'app-extra.js'), 'utf8');
  assert.match(app, /async function _ensureCompleteBusinessParts\(/);
  assert.match(app, /_ensureCompleteBusinessParts\(\['students', 'payments'\]\)/);
  assert.match(app, /_ensureCompleteBusinessParts\(\['students', 'reminders', 'payments', 'packages'\]\)/);
  assert.match(extra, /await _ensureCompleteBusinessParts\(\[\s*'students', 'packages', 'payments', 'sessions', 'reminders', 'expenses', 'wallet_tx'/);
  const dashboardParts = app.match(/dashboard:\s*\[([^\]]+)\]/)?.[1] || '';
  assert.match(dashboardParts, /'reminders'/);
});

test('todo archive and show-more can fetch additional server pages', () => {
  assert.match(app, /function _loadMoreTodos\(/);
  assert.match(app, /function _loadMoreTodoArchive\(/);
  assert.match(app, /\/todos\/stats/);
  assert.doesNotMatch(app, /if \(!!todo\?\.archived === !!archived && !pending\) existing\.delete\(id\)/);
});

test('todo list virtualization passes the row renderer explicitly', () => {
  assert.match(app, /function _todoRenderedListHtml\(items, key, renderFn\)/);
  assert.doesNotMatch(app, /renderFn\s*=\s*renderTodo/);
  assert.match(app, /_todoRenderedListHtml\([^\n]+renderTodo\)/);
});

test('client assets stay version-synced across app.js, app.html, and sw.js', () => {
  const version = app.match(/const TP_ASSET_V = 'tp(\d+)'/)?.[1];
  assert.ok(version, 'TP_ASSET_V must be defined in app.js');
  assert.match(app, new RegExp(`team-pulse-static-v${version}`));
  assert.match(html, new RegExp(`app\\.js\\?v=tp${version}`));
  assert.match(sw, new RegExp(`team-pulse-static-v${version}`));
  for (const match of html.matchAll(/\?v=tp(\d+)/g)) {
    assert.equal(match[1], version);
  }
});

test('todo list loads every active page and classifies overdue from scheduled date', () => {
  assert.match(app, /function _todoIsOverdue\(/);
  assert.match(app, /const isOverdue = _todoIsOverdue\(t\)/);
  assert.doesNotMatch(app, /_isTodoOverdue/);
  assert.match(app, /while \(!_todoPagingState\(false\)\.done && pages < 100\)/);
});
