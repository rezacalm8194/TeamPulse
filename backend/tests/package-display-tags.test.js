const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const financeSource = fs.readFileSync(path.join(root, 'app-finance.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const sigStart = source.indexOf('(', start);
  let depth = 0;
  let i = sigStart;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  i = source.indexOf('{', i);
  depth = 0;
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
sandbox.fa = n => String(n);
sandbox.escapeHtml = s => String(s == null ? '' : s);
for (const name of ['_serviceLabelKey', '_serviceMergeKey', '_isPlaceholderPackageLabel', 'uniqueDisplayPackages', 'pkgTag', '_pkgTitleLabel', 'pkgTagsHtml']) {
  vm.runInContext(extractFunction(appSource, name), sandbox);
}

test('account tables render unique package tags instead of one pill per purchase', () => {
  assert.match(appSource, /function uniqueDisplayPackages\(/);
  assert.match(appSource, /function pkgTagsHtml\(/);
  assert.match(appSource, /pkgTagsHtml\(s\.packages\)/);
  assert.match(financeSource, /pkgTagsHtml\(m\.packages\)/);
  assert.doesNotMatch(appSource, /\(s\.packages \|\| \[\]\)\.map\(pkgTag\)/);
  assert.doesNotMatch(appSource + financeSource, /\(m\.packages \|\| \[\]\)\.map\(pkgTag\)/);
});

test('pkgTagsHtml keeps two chips plus overflow so table rows stay one line', () => {
  const html = sandbox.pkgTagsHtml([
    { type_label: 'کوچینگ', type_color: '#7c6af7' },
    { type_label: 'سایت', type_color: '#60a5fa' },
    { type_label: 'ادیتور', type_color: '#4aa' },
    { type_label: 'ادمین', type_color: '#f47' },
  ]);
  assert.match(html, /class="pkg-tags"/);
  assert.match(html, /کوچینگ/);
  assert.match(html, /سایت/);
  assert.match(html, /pkg-tags-more/);
  assert.match(html, /\+2/);
  assert.doesNotMatch(html.replace(/title="[^"]*"/, ''), /ادیتور/);
  assert.match(html, /title="[^"]*ادیتور/);
});

test('student account name cell keeps family and drops join/session dates', () => {
  const nameCell = extractFunction(appSource, 'studentAccountNameCellHtml');
  const mobile = extractFunction(appSource, 'studentAccountMobileHtml');
  assert.doesNotMatch(nameCell, /date_jalali/);
  assert.doesNotMatch(nameCell, /studentContactScheduleHtml/);
  assert.match(nameCell, /family-badge/);
  assert.doesNotMatch(mobile, /studentContactScheduleHtml/);
  assert.match(mobile, /pkgTagsHtml\(s\.packages/);
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
