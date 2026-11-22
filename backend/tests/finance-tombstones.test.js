const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { mergeAndApplyDeletedItems, stampPatchDeletesAsTombstones } = require('../utils/deletedItems');
const { applyDocumentPatch } = require('../utils/documentPatch');

test('a stale device cannot bring back a deleted expense or shared account (full save)', () => {
  const previous = {
    expenses: [{ id: 2, amount: 500 }],
    families: [{ id: 'f2', name: 'kept' }],
    _deletedItems: { expenses: { '1': '2026-11-20T10:00:00.000Z' }, families: { f1: '2026-11-20T10:00:00.000Z' } },
  };
  const next = mergeAndApplyDeletedItems(previous, {
    expenses: [{ id: 1, amount: 900000 }, { id: 2, amount: 500 }],
    families: [{ id: 'f1', name: 'resurrected' }, { id: 'f2', name: 'kept' }],
    _deletedItems: {},
  });
  assert.deepEqual(next.expenses.map(e => e.id), [2]);
  assert.deepEqual(next.families.map(f => f.id), ['f2']);
});

test('a stale delta upsert of a deleted expense is dropped', () => {
  const previous = { expenses: [{ id: 1, amount: 900000, updated_at: '2026-11-19T00:00:00Z' }, { id: 2, amount: 500 }] };
  // Device A deletes expense 1.
  const deletePatch = { collections: { expenses: { delete: [1] } } };
  let data = stampPatchDeletesAsTombstones(applyDocumentPatch(previous, deletePatch), deletePatch);
  data = mergeAndApplyDeletedItems(previous, data);
  assert.deepEqual(data.expenses.map(e => e.id), [2]);
  // Device B (stale) later re-sends its old copy of expense 1.
  const stalePatch = { collections: { expenses: { upsert: [{ id: 1, amount: 900000, updated_at: '2026-11-21T00:00:00Z' }] } } };
  const after = mergeAndApplyDeletedItems(data, applyDocumentPatch(data, stalePatch));
  assert.deepEqual(after.expenses.map(e => e.id), [2]);
});

test('client never reuses a deleted id for a new expense, payment or shared account', () => {
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
  for (const collection of ['expenses', 'payments', 'families']) {
    // Another device's counter is behind: max present id is 4, ids 5 and 6
    // were deleted on this device.
    const sandbox = {
      _db: {
        [collection]: [{ id: 3 }, { id: 4 }],
        _nextId: { [collection]: 1 },
        _deletedItems: { [collection]: { '5': 't', '6': 't' } },
      },
    };
    vm.createContext(sandbox);
    for (const name of ['_collectionIdHighWater', '_bumpCollectionNextId', '_nextId']) vm.runInContext(grab(name), sandbox);
    assert.equal(sandbox._nextId(collection), 7, collection);
  }
});

test('deleting an expense or shared account records a tombstone on the client', () => {
  const extra = fs.readFileSync(path.resolve(__dirname, '../../app-extra.js'), 'utf8');
  const app = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
  const del = extra.slice(extra.indexOf('async function deleteExpense('), extra.indexOf('function openExpenseManager('));
  assert.match(del, /_recordDeletedItems\('expenses', id\)/);
  assert.match(app, /_db\.families=_db\.families\.filter\(x=>x\.id!==id\); _recordDeletedItems\('families', id\)/);
});
