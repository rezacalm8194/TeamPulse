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

function extractFn(source, name) {
  const match = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(source);
  assert.ok(match, name + ' not found');
  return match[0];
}

function loadSearchHelpers() {
  const ctx = vm.createContext({ String });
  vm.runInContext(extractFn(app, '_tpSearchNormalize'), ctx);
  vm.runInContext(extractFn(app, '_tpSearchHayFields'), ctx);
  vm.runInContext(extractFn(app, '_tpSearchRowMatches'), ctx);
  return ctx;
}

test('asset version remains tp424', () => {
  assert.match(app, /const TP_ASSET_V = 'tp424'/);
});

test('_tpSearchNormalize handles Persian Arabic variants, digits and zwnj removal', () => {
  const { _tpSearchNormalize } = loadSearchHelpers();
  assert.equal(_tpSearchNormalize('علي'), _tpSearchNormalize('علی'));
  assert.equal(_tpSearchNormalize('كتاب'), _tpSearchNormalize('کتاب'));
  assert.equal(_tpSearchNormalize('۰۹۱۲'), _tpSearchNormalize('0912'));
  assert.equal(_tpSearchNormalize('٠٩١٢'), _tpSearchNormalize('0912'));
  assert.equal(_tpSearchNormalize('می‌رود'), 'میرود');
  assert.equal(_tpSearchNormalize('می رود'), 'می رود');
});

test('compact hay matches spaced and zwnj variants', () => {
  const { _tpSearchHayFields, _tpSearchRowMatches, _tpSearchNormalize } = loadSearchHelpers();
  const row = _tpSearchHayFields('می‌رود');
  const q = _tpSearchNormalize('میروم');
  const qCompact = q.replace(/\s+/g, '');
  assert.ok(_tpSearchRowMatches(row, q, qCompact) || _tpSearchRowMatches(_tpSearchHayFields('می روم'), q, qCompact));
  assert.ok(_tpSearchRowMatches(_tpSearchHayFields('میروم'), 'میروم', 'میروم'));
});

test('_tpSearchInit uses e.code for keyboard shortcuts', () => {
  const block = extractTpSearchBlock(app);
  assert.match(block, /e\.code === 'KeyK'/);
  assert.match(block, /e\.code === 'Slash'/);
  assert.match(block, /e\.isComposing/);
  assert.match(block, /e\.repeat/);
});

test('_tpSearch enforces team access in index build', () => {
  const block = extractTpSearchBlock(app);
  assert.match(block, /_teamCan\('students'\)/);
  assert.match(block, /_todoCanView/);
  assert.match(block, /_teamCanWriteOwnerStudents/);
  assert.match(block, /_tpSearchCommandAllowed/);
  assert.match(block, /_teamCan\('payments'\)/);
  assert.match(block, /_teamCan\('dashboard'\)/);
});

test('mouseenter highlight uses per-option index closure', () => {
  const block = extractTpSearchBlock(app);
  assert.match(block, /const myIdx = optIdx/);
  assert.match(block, /_tpSearchUi\.active = myIdx/);
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

test('_tpSearchOpen keeps input enabled and guards stale async with openSeq', () => {
  const block = extractTpSearchBlock(app);
  assert.doesNotMatch(block, /input\.disabled\s*=\s*true/);
  assert.match(block, /seq !== _tpSearchUi\.openSeq/);
  assert.match(block, /openSeq/);
});