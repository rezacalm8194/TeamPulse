const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const appPath = path.join(root, 'app.js');
const appHtmlPath = path.join(root, 'app.html');
const cssPath = path.join(root, 'app.css');
const swPath = path.join(root, 'sw.js');
const app = fs.readFileSync(appPath, 'utf8');
const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const sw = fs.readFileSync(swPath, 'utf8');

function extractBetween(source, start, end) {
  const i = source.indexOf(start);
  assert.ok(i >= 0, start + ' not found');
  const j = source.indexOf(end, i + start.length);
  assert.ok(j >= 0, end + ' not found after ' + start);
  return source.slice(i, j);
}

function bootBnVm(extra = {}) {
  const ctx = vm.createContext({
    BN_FILL_POOL: ['home', 'students', 'todolist', 'dashboard', 'calendar', 'goals', 'habits', 'instructions'],
    DEFAULT_BN_PAGES: ['home', 'students', 'todolist', 'dashboard'],
    BN_STORAGE_KEY: 'teampulse_bn_pages',
    _isTeamGuest() { return false; },
    _teamCan() { return true; },
    localStorage: {
      _bag: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._bag, k) ? this._bag[k] : null; },
      setItem(k, v) { this._bag[k] = String(v); },
      removeItem(k) { delete this._bag[k]; },
    },
    ...extra,
  });
  vm.runInContext(extractBetween(app, 'function _bnPageAllowed(page)', 'function _bnAllowedPages()'), ctx);
  vm.runInContext(extractBetween(app, 'function _bnAllowedPages()', 'function _getSavedBnPages()'), ctx);
  vm.runInContext(extractBetween(app, 'function _getSavedBnPages()', 'function _resolveBottomNavSlots()'), ctx);
  vm.runInContext(extractBetween(app, 'function _resolveBottomNavSlots()', 'function _persistBnPages('), ctx);
  return ctx;
}

test('asset version is tp436', () => {
  assert.match(app, /const TP_ASSET_V = 'tp436'/);
  assert.match(appHtml, /\?v=tp436/);
  assert.match(sw, /team-pulse-static-v434/);
  assert.match(appHtml, /fonts\/Vazirmatn-Regular\.woff2\?v=tp402/);
});

test('default bottom nav pages are home, students, todolist, dashboard', () => {
  assert.match(app, /const DEFAULT_BN_PAGES = \['home', 'students', 'todolist', 'dashboard'\]/);
});

test('BN_PAGE_DEFS has labels only (no emoji icons)', () => {
  const block = extractBetween(app, 'const BN_PAGE_DEFS = {', '};');
  assert.doesNotMatch(block, /icon:\s*'/);
  assert.doesNotMatch(block, /[\u{1F300}-\u{1FAFF}]/u);
  assert.match(app, /function _bnNavSvgMarkup\(/);
});

test('_resolveBottomNavSlots fills from pool when saved pages are invalid', () => {
  const ctx = bootBnVm();
  ctx.localStorage.setItem('teampulse_bn_pages', JSON.stringify(['students', 'dashboard', 'bogus', 'nope']));
  const slots = vm.runInContext('JSON.stringify(_resolveBottomNavSlots())', ctx);
  assert.equal(slots, JSON.stringify(['students', 'dashboard', 'home', 'todolist']));
});

test('teammate without students and dashboard gets next allowed bottom nav pages', () => {
  const ctx = bootBnVm({
    _isTeamGuest() { return true; },
    _teamCan(page) {
      if (page === 'students' || page === 'dashboard') return false;
      return true;
    },
  });
  const slots = vm.runInContext('JSON.stringify(_resolveBottomNavSlots())', ctx);
  assert.equal(slots, JSON.stringify(['home', 'todolist', 'calendar', 'goals']));
  assert.equal(slots.includes('"students"'), false);
  assert.equal(slots.includes('"dashboard"'), false);
});

test('hamburger-btn hidden only inside mobile media query', () => {
  const marker = '/* ── Tablet & Mobile (≤768px)';
  const idx = css.indexOf(marker);
  assert.ok(idx >= 0, 'main 768px block marker missing');
  const end = css.indexOf('/* ── Tablet', idx + marker.length);
  const mobileBlock = css.slice(idx, end > idx ? end : idx + 8000);
  assert.match(mobileBlock, /#hamburger-btn\{display:none!important\}/);
  assert.doesNotMatch(css.slice(0, idx), /#hamburger-btn\{display:none!important\}/);
});

test('app.html bn-row ships default items before JS', () => {
  const row = appHtml.match(/id="bn-row"([\s\S]*?)<\/div>\s*<div class="bn-safe-spacer"/);
  assert.ok(row, 'bn-row block missing');
  assert.match(row[1], /data-page="home"/);
  assert.match(row[1], /data-page="students"/);
  assert.match(row[1], /data-page="todolist"/);
  assert.match(row[1], /data-page="dashboard"/);
  assert.match(row[1], /<svg/);
  assert.doesNotMatch(row[1], /role="listitem"/);
  assert.doesNotMatch(row[0], /role="list"/);
});

test('bottom nav render avoids list/listitem roles', () => {
  const renderBlock = extractBetween(app, 'function _renderBottomNav()', 'function _syncBnReminderBadgeFromSidebar');
  assert.doesNotMatch(renderBlock, /role="listitem"/);
  assert.doesNotMatch(appHtml, /id="bn-row"[^>]*role="list"/);
});

test('early bottom nav boot after local meta', () => {
  assert.match(app, /function _bootstrapBottomNavEarly\(/);
  assert.match(app, /function _readLocalMetaForBoot\(/);
  assert.match(app, /_bootstrapBottomNavEarly\(\)/);
});

test('backup and import remain in settings data pane', () => {
  assert.match(app, /پشتیبان|backup/i);
  assert.match(app, /وارد کردن|importBackup/i);
  assert.match(appHtml, /sidebar-data-actions/);
});