const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  patchLooksDestructive, looksLikeDestructiveOverwrite,
  looksLikeDestructiveCollectionOverwrite, mergeAndApplyDeletedItems,
} = require('../utils/deletedItems');

const rows = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, archived: true }));
const tombstones = Object.fromEntries(rows.map(row => [row.id, '2026-09-06T12:00:00Z']));

test('refresh pagination cannot restore archive rows deleted while the request was in flight', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
  const start = source.indexOf('async function _loadBusinessPage(');
  const end = source.indexOf('\nasync function _loadMoreBusiness(', start);
  const state = { search: '', done: false };
  let respond;
  const pending = new Promise(resolve => { respond = resolve; });
  const c = vm.createContext({
    window: {}, _db: { students: rows.slice(), _deletedItems: {} },
    _sbUser: { id: 'owner' }, _sbSession: { token: 'test' },
    BUSINESS_PAGINATED_KEYS: ['students'], BUSINESS_SERVER_PAGE_SIZE: 200, DB_KEY: 'test',
    _businessPagingState: () => state, _teamAccessSession: () => null,
    _workspaceQuery: () => '?workspace=default', _apiFetch: () => pending,
    _mergeBusinessRow: (key, local, remote) => remote,
    _persistPartLoadState: () => {}, _persistDatabaseSnapshot: () => {},
  });
  vm.runInContext(source.slice(start, end), c);
  const loading = c._loadBusinessPage('students', { reset: true });
  c._db.students = [];
  c._db._deletedItems.students = { ...tombstones };
  respond({ ok: true, json: async () => ({ items: [...rows, { id: 251 }], total: 251 }) });
  await loading;
  assert.deepEqual(Array.from(c._db.students, row => row.id), [251]);
});

test('explicit archive wipe passes both server guards and stale rows stay deleted', () => {
  const previous = { students: rows };
  const patch = {
    collections: { students: { upsert: [], delete: rows.map(row => row.id) } },
    scalars: { _deletedItems: { students: tombstones } },
  };
  assert.equal(patchLooksDestructive(previous, patch), false);
  const deleted = mergeAndApplyDeletedItems(previous, { students: [], ...patch.scalars });
  assert.equal(looksLikeDestructiveCollectionOverwrite(previous, deleted), false);
  assert.equal(looksLikeDestructiveOverwrite(previous, deleted), false);
  const staleWrite = mergeAndApplyDeletedItems(deleted, { students: rows });
  assert.deepEqual(staleWrite.students, []);
});

test('missing or unrelated deletion markers do not authorize an archive wipe', () => {
  const previous = { students: rows };
  const patch = { collections: { students: { delete: rows.map(row => row.id) } } };
  assert.equal(patchLooksDestructive(previous, patch), true);
  const next = { students: [], _deletedItems: { payments: tombstones } };
  assert.equal(looksLikeDestructiveCollectionOverwrite(previous, next), true);
  assert.equal(looksLikeDestructiveOverwrite(previous, next), true);
});

test('client applies mass archive tombstones even before pagination finishes', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
  const start = source.indexOf('function _applyDeletedItemTombstones(');
  const end = source.indexOf('\nfunction _load()', start);
  const context = vm.createContext({
    _STUDENT_TOMBSTONE_RELATIONS: ['packages', 'payments', 'sessions', 'wallet_tx', 'reminders', 'topics', 'key_events'],
    _serverPageTotalForKey: () => 1,
    _collectionLooksTruncatedRelativeToLocal: () => true,
    _tombstoneStripWouldTruncate: () => true,
    _isPaginatedSyncKey: () => true,
    _paginatedCollectionFullyLoaded: () => false,
  });
  vm.runInContext(source.slice(start, end), context);
  const data = { students: [...rows, { id: 251 }], _deletedItems: { students: { ...tombstones } } };
  context._applyDeletedItemTombstones(data);
  assert.deepEqual(data.students, [{ id: 251 }]);
  assert.equal(Object.keys(data._deletedItems.students).length, 250);
});
