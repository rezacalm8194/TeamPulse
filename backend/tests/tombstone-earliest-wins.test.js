const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { mergeAndApplyDeletedItems } = require('../utils/deletedItems');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const OLD = '2026-11-01T10:00:00.000Z';
const NOW = '2026-11-24T15:10:00.000Z';

test('server keeps the earliest deletion time when a device re-stamps a tombstone', () => {
  const previous = { _deletedItems: { todos: { 1: OLD }, expenses: { 7: OLD } }, expenses: [] };
  const next = { _deletedItems: { todos: { 1: NOW, 2: NOW }, expenses: { 7: NOW } }, expenses: [] };
  const merged = mergeAndApplyDeletedItems(previous, next, { inferRemovals: false });
  assert.equal(merged._deletedItems.todos['1'], OLD);
  assert.equal(merged._deletedItems.todos['2'], NOW, 'a new tombstone is still added');
  assert.equal(merged._deletedItems.expenses['7'], OLD);
});

test('server: an older stamp from another device replaces a newer one; empty stamps never erase', () => {
  const merged = mergeAndApplyDeletedItems(
    { _deletedItems: { todos: { 1: NOW, 3: OLD } } },
    { _deletedItems: { todos: { 1: OLD, 3: '' } } },
    { inferRemovals: false },
  );
  assert.equal(merged._deletedItems.todos['1'], OLD);
  assert.equal(merged._deletedItems.todos['3'], OLD);
});

test('re-sending the same tombstones with fresh stamps leaves the server value unchanged', () => {
  let stored = { _deletedItems: { todos: { 1: OLD, 5: OLD } } };
  for (let i = 0; i < 3; i++) {
    const stamp = new Date(Date.parse(NOW) + i * 30000).toISOString();
    const before = JSON.stringify(stored._deletedItems);
    stored = mergeAndApplyDeletedItems(stored, { _deletedItems: { todos: { 1: stamp, 5: stamp } } }, { inferRemovals: false });
    assert.equal(JSON.stringify(stored._deletedItems), before);
  }
});

test('client merge uses the same earliest-wins rule', () => {
  const start = app.indexOf('function _mergeDeletedItemMaps(');
  const end = app.indexOf('function _overlayPartialServerData(', start);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(app.slice(start, end) + '\nthis.m=_mergeDeletedItemMaps;', ctx);
  const merged = ctx.m({ todos: { 1: OLD } }, { todos: { 1: NOW, 2: NOW } });
  assert.equal(merged.todos['1'], OLD);
  assert.equal(merged.todos['2'], NOW);
  assert.equal(ctx.m({ todos: { 1: NOW } }, { todos: { 1: OLD } }).todos['1'], OLD);
  const pending = app.slice(app.indexOf('function _mergeLocalPendingChangesIntoOwnerData('), app.indexOf('const resurrectLocal = '));
  assert.match(pending, /else if \(deletedAt && String\(deletedAt\) < String\(remoteDeletedAt\)\)/);
  assert.doesNotMatch(app, /String\(deletedAt \|\| ''\) >= String\(/);
});
