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

const ownerSettingsHtml = extractBetween(
  app,
  '  const html = `\n  ${checklistHtml}',
  '  `;\n  setContent(html);',
);

function paneBlock(paneId) {
  const start = `id="pane-${paneId}"`;
  const i = ownerSettingsHtml.indexOf(start);
  assert.ok(i >= 0, `pane ${paneId} not found`);
  const slice = ownerSettingsHtml.slice(i);
  const next = slice.search(/\n\s*<div class="settings-pane/);
  return next > 0 ? slice.slice(0, next) : slice;
}

function h3Titles(block) {
  return [...block.matchAll(/<h3[^>]*>([^<]+)</g)].map((m) => m[1].trim());
}

function bootSettingsTabVm() {
  const block = extractBetween(app, 'const SETTINGS_TAB_IDS =', 'function _restoreSettingsTabFromStorage');
  const ctx = vm.createContext({});
  vm.runInContext(block + '\nfunction _normalizeSettingsTab(tab) {\n  const key = String(tab || \'\').trim().toLowerCase();\n  if (!key) return \'account\';\n  if (SETTINGS_TAB_IDS.includes(key)) return key;\n  return SETTINGS_TAB_LEGACY_MAP[key] || \'account\';\n}\nfunction _resolveSettingsTabTarget(tab, sectionId) {\n  const key = String(tab || \'\').trim().toLowerCase();\n  if (sectionId) return { tab: _normalizeSettingsTab(tab), section: sectionId };\n  const legacy = SETTINGS_LEGACY_SECTION_MAP[key];\n  if (legacy) return { tab: legacy.tab, section: legacy.section || \'\' };\n  return { tab: _normalizeSettingsTab(tab), section: \'\' };\n}', ctx);
  return ctx;
}

test('asset version is tp434', () => {
  assert.match(app, /const TP_ASSET_V = 'tp434'/);
  assert.match(appHtml, /\?v=tp434/);
  assert.match(sw, /team-pulse-static-v434/);
  assert.match(appHtml, /fonts\/Vazirmatn-Regular\.woff2\?v=tp402/);
});

test('settings tabs exclude advanced; danger zone lives in data pane', () => {
  assert.doesNotMatch(app, /pane-advanced/);
  assert.doesNotMatch(app, /switchSettingsTab\('advanced'\)/);
  assert.doesNotMatch(app, /data-tab="advanced"/);
  assert.doesNotMatch(app, /پیشرفته/);
  const data = paneBlock('data');
  assert.match(data, /settings-danger-zone/);
  assert.match(data, /منطقه خطرناک/);
});

test('each settings section sits in the correct tab pane', () => {
  const expect = {
    account: ['🔐 امنیت حساب و رمز عبور', '📱 شماره تماس بازیابی'],
    business: [
      'برچسب‌های برنامه',
      'خدمات قابل ارائه',
      'اتوماسیون ساده',
      '🌍 منطقه زمانی و تقویم',
      '📅 دسته‌های مناسبت‌های تقویم',
    ],
    connections: [
      'بله‌پی — لینک پرداخت',
      '🗓️ اتصال به Google Calendar',
      '☁️ اتصال به Google Drive',
    ],
    personal: ['🎨 ظاهر', 'نوار پایین گوشی', '🎙️ ورودی صوتی (Voice to Text)'],
    data: ['درباره و پشتیبان‌گیری', '↩️ بازگشت به نسخه‌های قبلی', '⚠️ منطقه خطرناک'],
  };
  for (const [pane, titles] of Object.entries(expect)) {
    const block = paneBlock(pane);
    const found = h3Titles(block);
    for (const t of titles) {
      assert.ok(found.some((h) => h.includes(t) || t.includes(h)),
        `pane ${pane} missing section "${t}"; got: ${found.join(' | ')}`);
    }
    assert.equal(found.length, titles.length, `pane ${pane} section count`);
  }
  const personal = paneBlock('personal');
  assert.match(personal, /\$\{_pushSettingsSectionHtml\(\)\}/);
  assert.match(personal, /settings-voice/);
});

test('legacy settings tab keys map to new tabs', () => {
  const ctx = bootSettingsTabVm();
  const cases = [
    ['general', 'business'],
    ['services', 'business'],
    ['advanced', 'data'],
    ['security', 'account'],
    ['backup', 'data'],
    ['personal', 'personal'],
    ['team', 'team'],
    ['data', 'data'],
    ['connections', 'connections'],
    ['account', 'account'],
  ];
  for (const [legacy, tab] of cases) {
    assert.equal(vm.runInContext(`_normalizeSettingsTab('${legacy}')`, ctx), tab, legacy);
  }
  assert.deepEqual(
    vm.runInContext(`JSON.stringify(_resolveSettingsTabTarget('advanced',''))`, ctx),
    JSON.stringify({ tab: 'data', section: 'settings-danger-zone' }),
  );
  assert.deepEqual(
    vm.runInContext(`JSON.stringify(_resolveSettingsTabTarget('services',''))`, ctx),
    JSON.stringify({ tab: 'business', section: 'settings-services' }),
  );
  assert.deepEqual(
    vm.runInContext(`JSON.stringify(_resolveSettingsTabTarget('security',''))`, ctx),
    JSON.stringify({ tab: 'account', section: '' }),
  );
});

test('setup checklist respects force-show flag and reopen link', () => {
  assert.match(app, /const checklistHidden = \(allDone \|\| checklistDismissed\) && !window\._tpForceShowSetupChecklist/);
  assert.match(app, /window\._tpForceShowSetupChecklist = true/);
  assert.match(app, /function dismissSetupChecklist\(\)[\s\S]*window\._tpForceShowSetupChecklist = false/);
  assert.match(app, /\$\{checklistHidden \? `<p[^`]*_reopenSetupChecklist\(\)/);
  assert.doesNotMatch(app, /\$\{allDone \? `<p[^`]*_reopenSetupChecklist/);
  assert.doesNotMatch(app, /SETTINGS_TAB_LEGACY_MAP = \{[\s\S]*personal: 'personal'/);
  assert.doesNotMatch(app, /SETTINGS_TAB_LEGACY_MAP = \{[\s\S]*connections: 'connections'/);
});

test('normalize settings tab still maps personal and connections by id list', () => {
  const ctx = bootSettingsTabVm();
  assert.equal(vm.runInContext(`_normalizeSettingsTab('personal')`, ctx), 'personal');
  assert.equal(vm.runInContext(`_normalizeSettingsTab('connections')`, ctx), 'connections');
});

test('mobile settings tabs have touch scroll and 44px tap height', () => {
  assert.match(css, /\.settings-tabs[\s\S]*-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /\.settings-tab[\s\S]*min-height:\s*44px/);
  assert.match(app, /_scrollSettingsActiveTab/);
  assert.match(app, /scrollIntoView/);
});

test('default settings tab is account', () => {
  assert.match(app, /let _settingsActiveTab = 'account'/);
  assert.match(app, /return 'account'/);
});