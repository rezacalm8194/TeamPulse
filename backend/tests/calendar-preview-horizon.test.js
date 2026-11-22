// The calendar expands repeat previews only up to what the view can show.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.resolve(__dirname, '../../app-todos.js'), 'utf8');
function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

function sandboxFor(mode, cursor, selected = '') {
  const parse = s => String(s).split('/').map(Number);
  const sb = {
    _todoViewMode: mode,
    _todoCalendarCursor: cursor,
    _todoCalendarSelectedDate: selected,
    _todayJalaliStr: () => '1405/09/01',
    _jalaliParse: parse,
    _jalaliKey: s => { const [y, m, d] = parse(s); return y && m && d ? y * 10000 + m * 100 + d : 0; },
    Math,
  };
  vm.createContext(sb);
  vm.runInContext(grab('_todoCalendarPreviewHorizonKey'), sb);
  return sb;
}

test('horizon covers the shown month and the next one, or the whole shown year', () => {
  assert.equal(sandboxFor('month', '1405/09/10')._todoCalendarPreviewHorizonKey(), 14051131);
  assert.equal(sandboxFor('week', '1405/09/28')._todoCalendarPreviewHorizonKey(), 14051131);
  assert.equal(sandboxFor('month', '1405/12/15')._todoCalendarPreviewHorizonKey(), 14060231, 'wraps the year');
  assert.equal(sandboxFor('year', '1405/03/01')._todoCalendarPreviewHorizonKey(), 14060131);
  assert.equal(sandboxFor('month', '1405/09/10', '1406/05/01')._todoCalendarPreviewHorizonKey(), 14060501, 'a selected day is always covered');
});

test('repeat expansion stops at the horizon and the cache key includes it', () => {
  const fn = grab('_todoTasksForCalendar');
  assert.match(fn, /const horizonKey = _todoCalendarPreviewHorizonKey\(\);/);
  assert.match(fn, /_todoCalendarTasksSignature\(\) \+ '\|' \+ horizonKey/);
  assert.match(fn, /if \(_jalaliKey\(nextDate\) > horizonKey\) break;/);
});
