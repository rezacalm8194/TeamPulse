const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('session description skips auto-grow so typing does not reflow the whole form', () => {
  assert.match(appSource, /id="f-ses-note"[^>]*data-no-autogrow/);
  assert.match(appSource, /textarea:not\(\[data-autogrow-ready\]\):not\(\[data-no-autogrow\]\)/);
  assert.match(appSource, /:not\(#f-ses-note\)/);
  assert.match(appSource, /function _stripSessionNoteAutoGrow\(/);
  assert.match(appSource, /if \(!el \|\| el\.dataset\.noAutogrow === '1' \|\| el\.id === 'f-ses-note'\) return;/);
  assert.match(appSource, /_stripSessionNoteAutoGrow\(ta\);/);
  assert.doesNotMatch(appSource, /ta\.addEventListener\('keyup', keepCaretVisible\)/);
  assert.match(appSource, /if \(caretRaf\) return;/);
  assert.match(cssSource, /session-note-wrap[\s\S]{0,220}contain:\s*layout style/);
});
