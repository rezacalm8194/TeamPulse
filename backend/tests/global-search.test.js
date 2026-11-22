const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const appPath = path.join(root, 'app.js');
const app = fs.readFileSync(appPath, 'utf8');

function extractTpSearchBlock(source) {
  const start = source.indexOf('// ── Global search / command palette (_tpSearch)');
  assert.ok(start >= 0, 'missing _tpSearch section');
  const end = source.indexOf('(function _tpSearchBoot()', start);
  assert.ok(end > start, 'missing _tpSearchBoot');
  return source.slice(start, end);
}

function extractNormalizeFn(source) {
  const match = /function _tpSearchNormalize\(str\) \{[\s\S]*?\n\}/.exec(source);
  assert.ok(match, '_tpSearchNormalize not found');
  return match[0];
}

function loadNormalize() {
  const ctx = vm.createContext({ String });
  vm.runInContext(extractNormalizeFn(app), ctx);
  return ctx._tpSearchNormalize;
}

test('asset version bumped for global search (tp423)', () => {
  assert.match(app, /const TP_ASSET_V = 'tp423'/);
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.match(html, /app\.js\?v=tp423/);
  assert.ok(html.includes('/fonts/Vazirmatn-Regular.woff2?v=tp402'), 'font preload version unchanged');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /team-pulse-static-v423/);
});

test('_tpSearchNormalize handles Persian Arabic variants and digits', () => {
  const norm = loadNormalize();
  assert.equal(norm('علي'), norm('علی'));
  assert.equal(norm('كتاب'), norm('کتاب'));
  assert.equal(norm('۰۹۱۲'), norm('0912'));
  assert.equal(norm('٠٩١٢'), norm('0912'));
  assert.equal(norm('می‌رود'), 'می رود');
});

test('_tpSearch section does not write or sync data', () => {
  const block = extractTpSearchBlock(app);
  assert.doesNotMatch(block, /_save\s*\(/);
  assert.doesNotMatch(block, /_syncToServer\s*\(/);
});

test('_tpSearch uses textContent for user-facing result text', () => {
  const block = extractTpSearchBlock(app);
  assert.match(block, /\.textContent\s*=\s*item\.title/);
  assert.match(block, /\.textContent\s*=\s*item\.subtitle/);
  assert.doesNotMatch(block, /innerHTML[\s\S]*item\.(title|subtitle)/);
});