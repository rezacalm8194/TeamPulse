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
  const finance = fs.readFileSync(path.join(root, 'app-finance.js'), 'utf8');
  assert.match(app, /async function _ensureCompleteBusinessParts\(/);
  assert.match(finance, /_ensureCompleteBusinessParts\(\['students', 'payments'\]\)/);
  assert.match(finance, /_ensureCompleteBusinessParts\(\['students', 'reminders', 'payments', 'packages'\]\)/);
  assert.match(extra, /await _ensureCompleteBusinessParts\(\[\s*'students', 'packages', 'payments', 'sessions', 'reminders', 'expenses', 'wallet_tx'/);
  const dashboardParts = app.match(/dashboard:\s*\[([^\]]+)\]/)?.[1] || '';
  assert.match(dashboardParts, /'reminders'/);
});

test('todo archive and show-more can fetch additional server pages', () => {
  const todos = fs.readFileSync(path.join(root, 'app-todos.js'), 'utf8');
  assert.match(app, /function _loadMoreTodos\(/);
  assert.match(todos, /function _loadMoreTodoArchive\(/);
  assert.match(app, /\/todos\/stats/);
  assert.doesNotMatch(app, /if \(!!todo\?\.archived === !!archived && !pending\) existing\.delete\(id\)/);
});

test('todo list virtualization passes the row renderer explicitly', () => {
  const todos = fs.readFileSync(path.join(root, 'app-todos.js'), 'utf8');
  assert.match(app, /function _todoRenderedListHtml\(items, key, renderFn\)/);
  assert.doesNotMatch(app, /renderFn\s*=\s*renderTodo/);
  assert.match(todos, /_todoRenderedListHtml\([^\n]+renderTodo\)/);
});

test('completed today todos stay inline in the today list', () => {
  const todos = fs.readFileSync(path.join(root, 'app-todos.js'), 'utf8');
  assert.doesNotMatch(todos, /todo-done-details/);
  assert.doesNotMatch(todos, /کار انجام‌شده امروز/);
  assert.match(todos, /todayTodos\.filter\(t => !mainTodayIds\.has\(t\.id\)\)\.sort\(_sortByTime\)/);
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

test('income tabs render 12 rows then a client-side load-more button', () => {
  assert.match(app, /PAYMENTS_LIST_CHUNK\s*=\s*12/);
  assert.match(app, /function _paymentsShowMore\(/);
  assert.match(app, /function _visiblePaymentsSlice\(/);
  assert.match(app, /function _clampIncomeLists\(/);
  assert.match(app, /income-show-more/);
  const finance = fs.readFileSync(path.join(root, 'app-finance.js'), 'utf8');
  assert.match(finance, /_visiblePaymentsSlice\('purchases'/);
  assert.match(finance, /_visiblePaymentsSlice\('payments'/);
  assert.match(finance, /_visiblePaymentsSlice\('reminders'/);
  assert.match(finance, /_visiblePaymentsSlice\('families'/);
  const src = app.match(/function _visiblePaymentsSlice\(tab, items\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'slice helper must exist');
  const PAYMENTS_LIST_CHUNK = 12;
  const shown = { purchases: 12, payments: 24 };
  const fn = new Function('PAYMENTS_LIST_CHUNK', '_paymentsListShown', `${src}; return _visiblePaymentsSlice;`);
  const slice = fn(PAYMENTS_LIST_CHUNK, shown);
  const first = slice('purchases', Array.from({ length: 51 }, (_, i) => i));
  assert.equal(first.rows.length, 12);
  assert.equal(first.remaining, 39);
  const expanded = slice('payments', Array.from({ length: 51 }, (_, i) => i));
  assert.equal(expanded.rows.length, 24);
  assert.equal(expanded.remaining, 27);
});

test('boot only loads the first active todo page and classifies overdue from scheduled date', () => {
  const todos = fs.readFileSync(path.join(root, 'app-todos.js'), 'utf8');
  assert.match(app, /function _todoIsOverdue\(/);
  assert.match(todos, /const isOverdue = _todoIsOverdue\(t\)/);
  assert.doesNotMatch(app, /_isTodoOverdue/);
  const ensure = app.match(/async function _ensureDocumentParts\(keys\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(ensure, /while\s*\(/);
  assert.match(ensure, /void _loadTodoStats\(\)/);
  assert.match(ensure, /_todoActiveTab === 'completed'/);
  assert.doesNotMatch(ensure, /while\s*\(!_todoPagingState\(false\)\.done/);
  assert.match(app, /for \(const archived of \(includeArchived \? \[false, true\] : \[false\]\)\)/);
});
