// Startup request shape: parallel section loads, no duplicate knowledge
// fetch, no Excel library on every open.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
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

test('business sections load with at most 4 requests in flight, all of them', async () => {
  const sandbox = { Promise, Array, Math, setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(`async ${grab('_tpRunWithConcurrency')}`, sandbox);
  let inFlight = 0, peak = 0;
  const done = [];
  const keys = ['students', 'sessions', 'payments', 'packages', 'families', 'reminders', 'expenses', 'wallet_tx'];
  await sandbox._tpRunWithConcurrency(keys, async key => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--; done.push(key);
  });
  assert.equal(peak, 4);
  assert.deepEqual(done.sort(), [...keys].sort());
  assert.doesNotMatch(src, /for \(const key of businessKeys\) \{\s*await _ensureBusinessPartLoaded/);
  assert.doesNotMatch(src, /for \(const key of BUSINESS_PAGINATED_KEYS\) \{\s*if \(!requested\.includes\(key\)\) continue;\s*await _ensureBusinessPartLoaded/);
});

test('knowledge parts delivered by the startup document are not fetched again', () => {
  const sandbox = { window: {}, Set, Object, _KNOWLEDGE_SESSION_REFRESH_KEYS: new Set(['instructions', 'guide_categories', 'guide_items']), _persistPartLoadState() {} };
  vm.createContext(sandbox);
  vm.runInContext(grab('_rememberServerParts'), sandbox);
  sandbox._rememberServerParts({
    partial: true,
    loaded_parts: ['__scalars__', 'instructions', 'guide_items', 'goals'],
    data: { instructions: [], guide_items: [], goals: [] },
  });
  const fetched = sandbox.window._tpSessionFetchedParts;
  assert.ok(fetched.has('instructions') && fetched.has('guide_items'));
  assert.ok(!fetched.has('guide_categories'), 'not in this response → still refreshed later');
  assert.ok(!fetched.has('goals'), 'only knowledge keys are marked');
});

test('the Excel library is not loaded on every app open', () => {
  assert.doesNotMatch(src, /setTimeout\(\(\)=>loadXlsxLibrary\(\)/);
  assert.match(src, /async function renderArchive\(\) \{\s*_warmXlsxLibrary\(\);/);
});
