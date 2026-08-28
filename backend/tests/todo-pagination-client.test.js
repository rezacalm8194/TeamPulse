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
  assert.match(app, /documentKeys\s*=\s*\(keys\s*\|\|\s*\[\]\)\.filter\(key\s*=>\s*key\s*!==\s*'todos'\)/);
  const core = app.match(/const _CORE_DOCUMENT_PARTS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(core, /'todos'/);
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

test('phase 4 client assets are consistently bumped to tp122', () => {
  assert.match(app, /TP_ASSET_V\s*=\s*'tp122'/);
  assert.doesNotMatch(html, /tp121/);
  assert.match(html, /app\.js\?v=tp122/);
  assert.match(sw, /team-pulse-static-v122/);
  assert.doesNotMatch(sw, /tp121/);
});
