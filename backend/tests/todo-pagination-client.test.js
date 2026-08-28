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
  assert.match(app, /!\['students', 'sessions', 'payments'\]\.includes\(key\)/);
  const core = app.match(/const _CORE_DOCUMENT_PARTS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(core, /'todos'/);
  assert.doesNotMatch(core, /'students'/);
  assert.doesNotMatch(core, /'sessions'/);
  assert.doesNotMatch(core, /'payments'/);
});

test('client loads business collections from paginated endpoints', () => {
  assert.match(app, /BUSINESS_SERVER_PAGE_SIZE\s*=\s*200/);
  assert.match(app, /function _ensureBusinessPartLoaded\(/);
  assert.match(app, /function _loadMoreBusiness\(/);
  assert.match(app, /'\/students'\s*\+\s*query|'\/'\s*\+\s*collection\s*\+\s*query/);
});

test('todo archive and show-more can fetch additional server pages', () => {
  assert.match(app, /function _loadMoreTodos\(/);
  assert.match(app, /function _loadMoreTodoArchive\(/);
  assert.match(app, /\/todos\/stats/);
});

test('todo list virtualization passes the row renderer explicitly', () => {
  assert.match(app, /function _todoRenderedListHtml\(items, key, renderFn\)/);
  assert.doesNotMatch(app, /renderFn\s*=\s*renderTodo/);
  assert.match(app, /_todoRenderedListHtml\([^\n]+renderTodo\)/);
});

test('phase 5 client assets are consistently bumped to tp123', () => {
  assert.match(app, /TP_ASSET_V\s*=\s*'tp123'/);
  assert.match(app, /team-pulse-static-v123/);
  assert.doesNotMatch(html, /tp122/);
  assert.match(html, /app\.js\?v=tp123/);
  assert.match(sw, /team-pulse-static-v123/);
  assert.doesNotMatch(sw, /tp122/);
});
