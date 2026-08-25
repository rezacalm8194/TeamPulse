const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const inlineBind = fs.readFileSync(path.join(root, 'tp-inline-bind.js'), 'utf8');

test('calendar layout is static and guest entry renders the requested hash', () => {
  assert.match(appCss, /\.todo-calendar-month-grid\s*\{[^}]*grid-template-columns:repeat\(7/m);
  assert.match(appJs, /function _todoCalendarResponsiveCss\(\)\s*\{[\s\S]*?return '';[\s\S]*?\}/);
  assert.doesNotMatch(appJs, /setContent\(`\$\{_todoCalendarResponsiveCss\(\)\}<style/);
  assert.match(inlineBind, /function _tpHideAuthShowApp\(\)[\s\S]*?renderPage\(\)/);
});

test('calendar chrome and reporting regressions stay fixed', () => {
  assert.match(appJs, /updateTopbarActions\(''\);\s*setContent\(`\$\{_todoCalendarResponsiveCss\(\)\}/);
  assert.doesNotMatch(appJs, /Math\.round\(list\.length \* \.75\)/);
  assert.match(appJs, /<details class="todo-calendar-filter-panel"/);
  assert.doesNotMatch(appJs, /function _todoPerformanceReportHtml\([^)]*\)\s*\{\s*if \(!_todoCalendarHasTaskFilters\(\)\)/);
  assert.match(appJs, /const weekDays = \['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'\]/);
});
