// Installed-app polish: maskable icons, home-screen shortcuts, theme follows
// the device until the user picks one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const { isAllowedStaticPath } = require('../utils/staticServing');
function grab(name) {
  const start = appJs.indexOf(`function ${name}(`);
  let depth = 0;
  for (let i = appJs.indexOf('{', start); i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}' && --depth === 0) return appJs.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

test('manifest has maskable icons that exist and are served', () => {
  const maskable = manifest.icons.filter(icon => icon.purpose === 'maskable');
  assert.deepEqual(maskable.map(icon => icon.sizes).sort(), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    const file = icon.src.replace(/^\//, '');
    assert.ok(fs.existsSync(path.join(root, file)), file);
    assert.equal(isAllowedStaticPath('/' + file), true, `${file} must be in the static allowlist`);
  }
});

test('shortcuts open real app pages', () => {
  const pages = vm.runInNewContext(appJs.match(/const _SAFE_RESTORE_PAGES = (\[[\s\S]*?\]);/)[1]);
  assert.ok(manifest.shortcuts.length >= 3);
  for (const s of manifest.shortcuts) {
    const m = s.url.match(/^\/app\?shortcut=1#([a-z_]+)$/);
    assert.ok(m, s.url);
    assert.ok(pages.includes(m[1]), m[1]);
  }
});

function initialPage({ hash, search = '', last = '' }) {
  const store = { tp_last_page: last };
  const sandbox = {
    location: { hash, search, pathname: '/app' },
    history: { replaceState() {} },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    URLSearchParams,
  };
  vm.createContext(sandbox);
  vm.runInContext(appJs.match(/const _SAFE_RESTORE_PAGES = [\s\S]*?\];/)[0] + grab('_parseAppHash') + grab('_getInitialPage'), sandbox);
  return vm.runInContext('_getInitialPage()', sandbox);
}

test('a shortcut opens its page even if it was the last page; plain reopen still lands home', () => {
  assert.equal(initialPage({ hash: '#todolist', search: '?shortcut=1', last: 'todolist' }), 'todolist');
  assert.equal(initialPage({ hash: '#todolist', last: 'todolist' }), 'home');
  assert.equal(initialPage({ hash: '#nope', search: '?shortcut=1' }), 'home');
});

test('theme follows the device until the user chooses, and keeps toggle state in sync', () => {
  const block = appJs.slice(appJs.indexOf('// Theme persistence.'), appJs.indexOf("// Sync reminder badge to bottom nav"));
  function run({ saved, systemLight }) {
    const classes = new Set();
    let listener = null;
    const sandbox = {
      isDark: true,
      toggleTheme() { sandbox.isDark = !sandbox.isDark; classes[sandbox.isDark ? 'delete' : 'add']('light'); },
      localStorage: { getItem: () => saved ?? null, setItem: (k, v) => { saved = v; } },
      window: { matchMedia: () => ({ matches: systemLight, addEventListener: (_, fn) => { listener = fn; } }) },
      document: { body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) } }, getElementById: () => null },
    };
    vm.createContext(sandbox);
    vm.runInContext(block, sandbox);
    return { sandbox, classes, fire: matches => listener && listener({ matches }), saved: () => saved };
  }
  const auto = run({ saved: null, systemLight: true });
  assert.ok(auto.classes.has('light'));
  assert.equal(auto.sandbox.isDark, false, 'isDark matches the applied theme');
  auto.fire(false);
  assert.ok(!auto.classes.has('light'), 'follows a live device change');
  const chosen = run({ saved: 'dark', systemLight: true });
  assert.ok(!chosen.classes.has('light'), 'explicit choice wins');
  chosen.fire(true);
  assert.ok(!chosen.classes.has('light'));
  const savedLight = run({ saved: 'light', systemLight: false });
  savedLight.sandbox.window.toggleTheme();
  assert.ok(!savedLight.classes.has('light'), 'first toggle from a saved light theme switches to dark');
  assert.equal(savedLight.saved(), 'dark');
});
