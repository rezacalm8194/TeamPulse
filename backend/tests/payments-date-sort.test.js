const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

const sandbox = {};
vm.createContext(sandbox);
for (const name of ['_jalaliParse', '_jalaliKey', '_sortPaymentsNewestFirst']) {
  vm.runInContext(extractFunction(appSource, name), sandbox);
}

test('receipts APIs sort by jalali date newest first instead of insertion order', () => {
  assert.match(appSource, /function _sortPaymentsNewestFirst\(/);
  assert.match(appSource, /getAll: \(\)=>_P\(_sortPaymentsNewestFirst\(_db\.payments\)\.slice\(0,300\)/);
  assert.match(appSource, /getByStudent: \(sid\)=>_P\(_sortPaymentsNewestFirst\(_rowsForStudent\('payments',sid\)\)/);
  assert.doesNotMatch(appSource, /getAll: \(\)=>_P\(\[\.\.\._db\.payments\]\.reverse\(\)\.slice\(0,300\)/);
  assert.match(appSource, /payments = _sortPaymentsNewestFirst\(payments\);/);
});

test('_sortPaymentsNewestFirst puts later jalali dates first even if inserted earlier', () => {
  const sorted = sandbox._sortPaymentsNewestFirst([
    { id: 1, date_jalali: '1405/02/06', created_at: '2026-09-07T10:00:00.000Z' },
    { id: 2, date_jalali: '1405/06/14', created_at: '2026-08-01T10:00:00.000Z' },
    { id: 3, date_jalali: '۱۴۰۵/۰۶/۱۲', created_at: '2026-08-02T10:00:00.000Z' },
    { id: 4, date_jalali: '1405/06/14', created_at: '2026-08-03T10:00:00.000Z' },
  ]);
  assert.deepEqual(sorted.map(p => p.id), [4, 2, 3, 1]);
});
