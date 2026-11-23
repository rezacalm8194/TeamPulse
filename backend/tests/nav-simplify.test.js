const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const appPath = path.join(root, 'app.js');
const appHtmlPath = path.join(root, 'app.html');
const financePath = path.join(root, 'app-finance.js');
const swPath = path.join(root, 'sw.js');
const app = fs.readFileSync(appPath, 'utf8');
const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
const finance = fs.readFileSync(financePath, 'utf8');
const sw = fs.readFileSync(swPath, 'utf8');

function extractFn(source, name) {
  const match = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(source);
  assert.ok(match, name + ' not found');
  return match[0];
}

test('asset version is tp428', () => {
  assert.match(app, /const TP_ASSET_V = 'tp428'/);
  assert.match(appHtml, /\?v=tp428/);
  assert.match(sw, /team-pulse-static-v428/);
});

test('Google Drive FOLDERS and FILES keep legacy lookup names', () => {
  assert.match(app, /این نام‌ها کلید پیدا کردن پوشه در Drive هستند؛ تغییر نده/);
  assert.match(app, /students:\s*'01 — شاگردان و امور مشتریان'/);
  assert.match(app, /sessions:\s*'02 — جلسات هر شاگرد'/);
  assert.match(app, /students:\s*'لیست شاگردان\.csv'/);
});

test('removeEmptyDefaultStudentsCategory matches legacy شاگردان title', () => {
  const extra = fs.readFileSync(path.join(root, 'app-extra.js'), 'utf8');
  assert.match(extra, /removeEmptyDefaultStudentsCategory[\s\S]{0,400}n\.title === 'شاگردان'/);
});

test('sidebar menu omits families and reminders items', () => {
  assert.doesNotMatch(appHtml, /data-page="families"/);
  assert.doesNotMatch(appHtml, /data-page="reminders"/);
  assert.match(appHtml, /data-page="payments"[^>]*>[\s\S]*payments-reminder-badge/);
});

test('customer accounts tab label is مانده حساب‌ها', () => {
  assert.match(finance, /_tpPaymentsTab\('families'\)">[^<]*مانده حساب‌ها/);
  assert.doesNotMatch(finance, /_tpPaymentsTab\('families'\)">[^<]*حساب مشتری</);
});

test('_homeNavigate still routes families and reminders to payments tabs', () => {
  const block = extractFn(app, '_homeNavigate');
  assert.match(block, /page === 'families'/);
  assert.match(block, /page === 'reminders'/);
  assert.match(block, /_paymentsTab/);
});

test('renderPage keeps hash aliases for families and reminders', () => {
  assert.match(app, /currentPage === 'reminders'[\s\S]*_paymentsTab = 'reminders'/);
  assert.match(app, /currentPage === 'families'[\s\S]*_paymentsTab = 'families'/);
});

test('_menuPageFor maps families and reminders to payments', () => {
  const block = extractFn(app, '_menuPageFor');
  assert.match(block, /page === 'reminders'/);
  assert.match(block, /page === 'families'/);
  assert.match(block, /return 'payments'/);
});

test('team guests see payments when they only have families or reminders', () => {
  const block = extractFn(app, '_teamCan');
  assert.match(block, /page === 'payments'/);
  assert.match(block, /\['reminders','families'\]/);
});

test('_entityWord helper defaults to مشتری/مشتریان', () => {
  const ctx = vm.createContext({ META: {}, escapeHtml: (s) => String(s) });
  vm.runInContext(extractFn(app, '_entityWordPlain'), ctx);
  vm.runInContext(extractFn(app, '_entityWord'), ctx);
  assert.equal(ctx._entityWordPlain(), 'مشتری');
  assert.equal(ctx._entityWordPlain(true), 'مشتریان');
  assert.equal(ctx._entityWord(), 'مشتری');
});

test('display templates avoid hardcoded شاگرد (excluding defaults and search keys)', () => {
  const chunks = ['app.js', 'app-finance.js', 'app-sessions.js', 'app-extra.js', 'app-todos.js']
    .map(f => fs.readFileSync(path.join(root, f), 'utf8'));
  const joined = chunks.join('\n');
  const lines = joined.split('\n').filter(line => {
    if (!line.includes('شاگرد')) return false;
    const t = line.trim();
    if (t.startsWith('//')) return false;
    if (t.includes('DEFAULT_META')) return false;
    if (t.includes('id_شاگرد') || t.includes('نام شاگرد')) return false;
    if (t.includes('keys:') && t.includes('شاگرد')) return false;
    if (t.includes('مثلاً «شاگرد»') || t.includes('مثلاً «شاگردان»')) return false;
    if (t.includes('به‌جای «شاگرد»')) return false;
    if (t.includes('|| \'شاگرد\'') || t.includes("|| 'شاگردان'")) return false;
    if (t.includes('تاریخچه رشد شاگرد')) return false;
    if (t.includes('// اسم شاگرد') || t.includes('// نام شاگرد') || t.includes('// پیدا کردن نام شاگرد')) return false;
    if (t.includes('// ── پایان ویزارد') || t.includes('// ── راهنمای آیکون')) return false;
    if (t.includes('FOLDERS:') || t.includes('FILES:') || t.includes('01 — شاگردان')) return false;
    if (t.includes('02 — جلسات هر شاگرد') || t.includes('لیست شاگردان.csv')) return false;
    if (t.includes("n.title === 'شاگردان'")) return false;
    if (t.includes('کلید پیدا کردن پوشه در Drive')) return false;
    return true;
  });
  assert.deepEqual(lines, [], 'unexpected شاگرد in display templates:\n' + lines.join('\n'));
});

test('menu badges hide zero counts', () => {
  assert.match(app, /function updateReminderBadges/);
  assert.match(app, /badge\.style\.display = count \? 'inline-block' : 'none'/);
  assert.match(app, /_sb\.style\.display = allStudents\.length \? '' : 'none'/);
  assert.match(app, /if \(n > 0\) \{ el\.style\.display = ''/);
  assert.match(appHtml, /id="student-badge" style="display:none"/);
});

test('duplicate renewal prefix is normalized; single prefix unchanged', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`const _PKG_RENEWAL_TITLE_CHUNK_RE = /^(تجدید|تمدید)\\s*پکیج\\s*[:：]\\s*/i;`, ctx);
  vm.runInContext(extractFn(app, '_dedupePkgRenewalTitle'), ctx);
  vm.runInContext(extractFn(app, '_displayReminderTitle'), ctx);
  assert.equal(ctx._displayReminderTitle('تجدید پکیج: تجدید پکیج: کوچینگ'), 'تجدید پکیج: کوچینگ');
  assert.equal(ctx._displayReminderTitle('تمدید پکیج: کوچینگ'), 'تمدید پکیج: کوچینگ');
  assert.equal(ctx._dedupePkgRenewalTitle('تجدید پکیج: کوچینگ'), 'تجدید پکیج: کوچینگ');
});

test('HTML templates do not embed _entityWordPlain in markup strings', () => {
  const chunks = ['app.js', 'app-finance.js', 'app-sessions.js', 'app-extra.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8'));
  const bad = [];
  for (const source of chunks) {
    for (const line of source.split('\n')) {
      if (!line.includes('_entityWordPlain')) continue;
      const trimmed = line.trim();
      if (!trimmed.includes('`') || !trimmed.includes('<')) continue;
      bad.push(trimmed);
    }
  }
  assert.deepEqual(bad, [], 'HTML templates should use _entityWord:\n' + bad.join('\n'));
});

test('backend push uses displayReminderTitle', () => {
  const route = fs.readFileSync(path.join(root, 'backend/routes/reminders.js'), 'utf8');
  assert.match(route, /displayReminderTitle\(/);
});