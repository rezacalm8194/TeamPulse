const test = require('node:test');
const assert = require('node:assert/strict');
const { clientClockSkewMs, correctRowClock, correctPatchClock } = require('../utils/clockSkew');
const { applyDocumentPatch } = require('../utils/documentPatch');

const SERVER_NOW = Date.UTC(2026, 10, 22, 14, 0, 0);
const HOUR = 3600e3;

test('skew is ignored when small, missing or absurd', () => {
  assert.equal(clientClockSkewMs(SERVER_NOW - 20e3, SERVER_NOW), 0, '20s network/drift');
  assert.equal(clientClockSkewMs(undefined, SERVER_NOW), 0);
  assert.equal(clientClockSkewMs('abc', SERVER_NOW), 0);
  assert.equal(clientClockSkewMs(SERVER_NOW - 400 * 24 * HOUR, SERVER_NOW), 0);
  assert.equal(clientClockSkewMs(SERVER_NOW - HOUR, SERVER_NOW), HOUR, 'phone 1h behind');
  assert.equal(clientClockSkewMs(SERVER_NOW + 2 * HOUR, SERVER_NOW), -2 * HOUR, 'phone 2h ahead');
});

test('only the timestamp used for conflicts is shifted', () => {
  const row = { id: 1, amount: 5, updated_at: '2026-11-22T12:30:00.000Z', created_at: '2026-11-01T00:00:00.000Z', date_jalali: '1405/09/01' };
  const fixed = correctRowClock(row, HOUR);
  assert.equal(fixed.updated_at, '2026-11-22T13:30:00.000Z');
  assert.equal(fixed.created_at, row.created_at);
  assert.equal(fixed.date_jalali, row.date_jalali, 'user-entered dates untouched');
  assert.equal(correctRowClock({ id: 2, created_at: '2026-11-22T12:00:00.000Z' }, HOUR).created_at, '2026-11-22T13:00:00.000Z');
  assert.deepEqual(correctRowClock({ id: 3 }, HOUR), { id: 3 });
});

test('a phone 1h behind no longer loses its edit to an older desktop edit', () => {
  // Desktop edited the price at 13:40 (real time). The phone edited it later,
  // at 13:55 real time, but its clock says 12:55.
  const stored = { payments: [{ id: 7, amount: 100, updated_at: '2026-11-22T13:40:00.000Z' }] };
  const phonePatch = () => ({ collections: { payments: { upsert: [{ id: 7, amount: 250, updated_at: '2026-11-22T12:55:00.000Z' }] } } });
  const phoneNow = SERVER_NOW - HOUR; // phone clock at send time

  const withoutFix = applyDocumentPatch(stored, phonePatch());
  assert.equal(withoutFix.payments[0].amount, 100, 'old behaviour: phone edit silently dropped');

  const patch = correctPatchClock(phonePatch(), clientClockSkewMs(phoneNow, SERVER_NOW));
  const withFix = applyDocumentPatch(stored, patch);
  assert.equal(withFix.payments[0].amount, 250);
});

test('a phone 2h ahead no longer blocks later desktop edits', () => {
  const phoneNow = SERVER_NOW + 2 * HOUR;
  const patch = correctPatchClock(
    { collections: { expenses: { upsert: [{ id: 1, amount: 10, updated_at: '2026-11-22T15:50:00.000Z' }] } } },
    clientClockSkewMs(phoneNow, SERVER_NOW),
  );
  let stored = applyDocumentPatch({ expenses: [] }, patch);
  assert.equal(stored.expenses[0].updated_at, '2026-11-22T13:50:00.000Z');
  // Desktop (correct clock) edits at 14:05 real time.
  stored = applyDocumentPatch(stored, { collections: { expenses: { upsert: [{ id: 1, amount: 99, updated_at: '2026-11-22T14:05:00.000Z' }] } } });
  assert.equal(stored.expenses[0].amount, 99);
});

test('client learns the server clock offset from the Date header and applies it only to local edits', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const src = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
  const grab = name => {
    const start = src.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unclosed ' + name);
  };
  const sandbox = { window: {}, Date, Math, Number };
  vm.createContext(sandbox);
  vm.runInContext(grab('_tpNoteServerClock') + '\n' + grab('_tpLocalEditTime'), sandbox);
  const headerFor = ms => ({ headers: { get: k => (k === 'Date' ? new Date(ms).toUTCString() : null) } });
  sandbox._tpNoteServerClock(headerFor(Date.now() + HOUR)); // device 1h behind
  assert.ok(Math.abs(sandbox.window._tpServerClockOffset - HOUR) < 2000);
  assert.ok(Math.abs(sandbox._tpLocalEditTime(1000) - (1000 + HOUR)) < 2000);
  assert.equal(sandbox._tpLocalEditTime(0), 0);
  sandbox._tpNoteServerClock(headerFor(Date.now() + 10e3)); // 10s: treated as in sync
  assert.equal(sandbox.window._tpServerClockOffset, 0);
  sandbox._tpNoteServerClock({ headers: { get: () => null } }); // no header: unchanged
  assert.equal(sandbox.window._tpServerClockOffset, 0);
  // Applied in the three "edited on this device" comparisons only.
  assert.match(src, /return _tpLocalEditTime\(localTs\) > remoteTs \? local : remote;/);
  assert.match(src, /const queuedTs = _tpLocalEditTime\(_businessRowTimestamp\(entry\.item\)\);/);
  assert.match(src, /const localTime = serverLooksPartial \? localRawTime : _tpLocalEditTime\(localRawTime\);/);
  assert.match(src, /_tpNoteServerClock\(response\);/);
});
