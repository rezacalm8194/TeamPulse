const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
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
for (const name of ['_serviceLabelKey', '_serviceMergeKey', '_isPlaceholderPackageLabel', 'uniqueDisplayPackages']) {
  vm.runInContext(extractFunction(appSource, name), sandbox);
}

test('account tables render unique package tags instead of one pill per purchase', () => {
  assert.match(appSource, /function uniqueDisplayPackages\(/);
  assert.match(appSource, /function pkgTagsHtml\(/);
  assert.match(appSource, /<td>\$\{pkgTagsHtml\(s\.packages\)\}<\/td>/);
  assert.match(appSource, /<td>\$\{pkgTagsHtml\(m\.packages\)\}<\/td>/);
  assert.doesNotMatch(appSource, /\(s\.packages \|\| \[\]\)\.map\(pkgTag\)/);
  assert.doesNotMatch(appSource, /\(m\.packages \|\| \[\]\)\.map\(pkgTag\)/);
});

test('uniqueDisplayPackages collapses same-type purchases and drops placeholder labels', () => {
  const result = sandbox.uniqueDisplayPackages([
    { type_id: 1, type_label: 'ادیتور', type_color: '#4aa' },
    { type_id: 1, type_label: 'ادیتور', type_color: '#4aa' },
    { type_id: 2, type_label: 'ادیت ویدیو', type_color: '#4aa' },
    { type_id: 3, type_label: 'سایت', type_color: '#88f' },
    { type_id: 4, type_label: '—' },
    { type_id: 5, type_label: '---' },
    { type_id: 6, type_label: 'تجدید پکیج سایت', type_color: '#88f' },
  ]);
  assert.equal(result.length, 2);
  const editor = result.find(p => p.type_label === 'ادیتور');
  const site = result.find(p => p.type_label === 'سایت');
  assert.equal(editor._count, 3);
  assert.equal(site._count, 2);
});
