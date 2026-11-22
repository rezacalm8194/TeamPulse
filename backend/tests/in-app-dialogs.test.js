// Native confirm/prompt/alert were replaced by Promise-based in-app dialogs.
// A missing `await` would turn `if (!await tpConfirm(...)) return;` into a
// check that always passes — i.e. a delete without confirmation. Guard it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const FILES = ['app.js', 'app-extra.js', 'app-todos.js', 'app-finance.js', 'app-sessions.js'];
const sources = Object.fromEntries(FILES.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
const lineOf = (s, i) => s.slice(0, i).split('\n').length;

test('no native browser dialogs remain', () => {
  const found = [];
  for (const [f, s] of Object.entries(sources)) {
    for (const m of s.matchAll(/(?<![\w.$])(confirm|prompt|alert)\(/g)) found.push(`${f}:${lineOf(s, m.index)} ${m[1]}`);
  }
  assert.deepEqual(found, []);
});

test('every tpConfirm / tpPrompt / tpChoose call is awaited', () => {
  const bad = [];
  let calls = 0;
  for (const [f, s] of Object.entries(sources)) {
    for (const m of s.matchAll(/(?<![\w.$])(tpConfirm|tpPrompt|tpChoose)\(/g)) {
      if (s.slice(Math.max(0, m.index - 9), m.index).endsWith('function ')) continue;
      calls++;
      if (s.slice(Math.max(0, m.index - 6), m.index) !== 'await ') bad.push(`${f}:${lineOf(s, m.index)}`);
    }
  }
  assert.ok(calls >= 55, `expected the replaced call sites, found ${calls}`);
  assert.deepEqual(bad, []);
});

test('dialogs are never used inside inline HTML handlers (cannot await there)', () => {
  for (const [f, s] of Object.entries(sources)) {
    assert.doesNotMatch(s, /on[a-z]+=["'][^"']*(tpConfirm|tpPrompt|tpChoose)/, f);
  }
});

test('two-choice dialogs treat dismiss (null) as "do nothing"', () => {
  const todos = sources['app-todos.js'];
  assert.match(todos, /const makeBoth = await tpChoose\([\s\S]*?\);\s*if \(makeBoth === null\) return;/);
  assert.match(todos, /const editOnlyThis = await tpChoose\([\s\S]*?\);\s*if \(editOnlyThis === null\) return;/);
  const app = sources['app.js'];
  assert.match(app, /const dismiss = \(\) => finish\(input \? null : \(alertOnly \? true : \(_choose \? null : false\)\)\);/);
});

test('destructive confirms focus the cancel button', () => {
  assert.match(sources['app.js'], /\(field \|\| \(danger && cancel\) \|\| ok\)\.focus\(\)/);
});
