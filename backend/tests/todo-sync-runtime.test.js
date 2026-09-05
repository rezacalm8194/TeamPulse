const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { ensureTodoStoreSchema, replaceTodos, upsertTodos, loadTodosPage } = require('../utils/todoStore');
const { applyTodoDeltaMerge } = require('../utils/todoMerge');

const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}
function client(fetch) {
  const c = vm.createContext({
    window: { _serverHydratedEtag: 'old', _serverDataEtag: 'old', _remoteServerDocumentChanged: true },
    _db: { todos: [] }, _sbUser: { id: 'owner' }, _sbSession: { token: 'test' },
    TODO_SERVER_PAGE_SIZE: 200, DB_KEY: 'test',
    _teamAccessSession: () => null, _workspaceQuery: () => '?workspace=default',
    _apiFetch: fetch, _readDurableTodoDeltaQueue: () => [],
    _applyTodoIdHighWater: () => {}, _persistPartLoadState: () => {},
    _persistDatabaseSnapshot: () => {}, _isTodoRecurring: () => false,
  });
  vm.runInContext(['_cloneData', '_todoMergeTime', '_todoHasReopenAfter', '_pickMergedTodo',
    '_todoPendingDeltaOp', '_todoServerHydrateIsAuthoritative', '_resolveIncomingTodo',
    '_todoPagingState', '_todoPagesStaleForServerEtag', '_loadTodoPage', '_reloadCompleteTodosFromServer'].map(extract).join('\n'), c);
  return c;
}
const done = { id: 201, done: true, archived: false, status: 'completed', done_at: '2026-09-05T08:00:00Z' };
const open = { ...done, done: false, status: 'pending', done_at: null };
const response = (items, cursor = null) => ({ ok: true, json: async () => ({ items, next_cursor: cursor, etag: 'new' }) });

test('Android receives desktop reopen on page two while hydrated etag is still old', async () => {
  const calls = [];
  const c = client(async url => {
    calls.push(url);
    if (url.includes('archived=1')) return response([]);
    if (url.includes('cursor=page2')) return response([open]);
    return response(Array.from({ length: 200 }, (_, i) => ({ id: i + 1, done: false })), 'page2');
  });
  c._db.todos = [structuredClone(done)];
  await c._reloadCompleteTodosFromServer({ reset: true });
  assert.equal(c._db.todos.find(t => t.id === 201).done, false);
  assert.equal(c._todoPagingState(false).done, true);
  assert.equal(calls.length, 3);
});

test('failed task page cannot be reported as a complete hydration', async () => {
  const c = client(async () => ({ ok: false }));
  assert.equal(await c._reloadCompleteTodosFromServer({ reset: true }), false);
  assert.notEqual(c._todoPagingState(false).fetchedEtag, 'new');
  assert.equal(c._todoPagesStaleForServerEtag('old'), true);
});

test('a GET started before an acknowledged local reopen cannot re-check it', async () => {
  let deliver;
  const c = client(() => new Promise(resolve => { deliver = resolve; }));
  c._db.todos = [structuredClone(done)];
  const pending = c._loadTodoPage(false, { reset: true });
  c._db.todos = [structuredClone(open)];
  c.window._todoDeltaEpoch = { 201: 1 };
  // The delta was acknowledged, so the durable queue is already empty.
  deliver(response([done]));
  await pending;
  assert.equal(c._db.todos[0].done, false);
});

for (const direction of ['desktop to Android', 'Android to desktop']) {
  for (const occurrence of [false, true]) {
    test(`${direction}: actual uncheck, SQLite persistence and multi-page receive (${occurrence ? 'occurrence' : 'one-shot'})`, async t => {
      const db = new Database(':memory:');
      t.after(() => db.close());
      ensureTodoStoreSchema(db);
      const initial = { ...done, id: 9999, date_jalali: '1405/06/14', repeat: 'none',
        archived: occurrence, _snapshot: occurrence, _occurrence: occurrence };
      replaceTodos(db, 'owner', [
        ...Array.from({ length: 401 }, (_, i) => ({ id: i + 1, date_jalali: '1405/06/13', done: false })),
        initial,
      ]);
      const receive = async url => {
        const query = new URL(url, 'https://test.invalid').searchParams;
        return { ok: true, json: async () => ({
          ...loadTodosPage(db, 'owner', { archived: Number(query.get('archived')), cursor: query.get('cursor'), limit: 200 }),
          etag: 'new',
        }) };
      };
      const sender = client(receive);
      const receiver = client(receive);
      sender._db.todos = [structuredClone(initial)];
      receiver._db.todos = [structuredClone(initial)];
      let sentOperation;
      Object.assign(sender, {
        _todoScheduledDate: t => t.date_jalali,
        _jalaliKey: () => 14050614, _jalaliToday: () => 14050614,
        _teamEmail: () => '', _todoRemainsOpenToday: () => true,
        renderTodoList: () => {}, _save: () => {},
        _syncTodoDelta: (todo, op) => {
          sentOperation = op;
          upsertTodos(db, 'owner', [applyTodoDeltaMerge(todo, initial, op)]);
        },
      });
      vm.runInContext(['_todoAddHistory', '_completeTodoWithReport'].map(extract).join('\n'), sender);
      sender._completeTodoWithReport(sender._db.todos[0], '');
      assert.equal(sentOperation, 'reopen');
      assert.equal(await receiver._reloadCompleteTodosFromServer({ reset: true }), true);
      const received = receiver._db.todos.find(t => t.id === initial.id);
      assert.equal(received.done, false);
      assert.equal(received.archived, false);
      assert.equal(received._snapshot, false);
      assert.equal(received.status, 'pending');
      assert.equal(received.date_jalali, '1405/06/14');
      assert.equal(receiver._db.todos.length, 402);
    });
  }
}

test('a failed continuation is retried even when the first page has the latest etag', async () => {
  let fail = true;
  const c = client(async url => {
    if (url.includes('archived=1')) return response([]);
    if (!url.includes('cursor=')) return response([{ id: 1 }], 'page2');
    if (fail) return { ok: false };
    return response([open]);
  });
  assert.equal(await c._reloadCompleteTodosFromServer(), false);
  assert.equal(c._todoPagesStaleForServerEtag('new'), true);
  fail = false;
  assert.equal(await c._reloadCompleteTodosFromServer(), true);
  assert.equal(c._todoPagesStaleForServerEtag('new'), false);
  assert.equal(c._db.todos.find(t => t.id === open.id).done, false);
});

test('a reset waits for an older in-flight page and then fetches again', async () => {
  let deliver;
  let calls = 0;
  const c = client(() => ++calls === 1 ? new Promise(resolve => { deliver = resolve; }) : response([open]));
  c._db.todos = [structuredClone(done)];
  const oldRead = c._loadTodoPage(false);
  const refresh = c._loadTodoPage(false, { reset: true });
  deliver(response([done]));
  await Promise.all([oldRead, refresh]);
  assert.equal(calls, 2);
  assert.equal(c._db.todos[0].done, false);
});

test('document polling does not mark a failed todo hydration as synchronized', async () => {
  const c = client(async url => url.includes('/todos') ? { ok: false } : {
    ok: true, headers: { get: () => 'application/json' },
    json: async () => ({ data: {}, etag: 'new', partial: true }),
  });
  Object.assign(c, {
    BUSINESS_PAGINATED_KEYS: [], _isManualRestoreProtected: () => false,
    _currentAccountId: () => 'default', _loadTodoStats: () => {},
    _shouldLoadFullDocument: () => true, _documentIncludeQuery: () => '',
    _reloadCompleteBusinessPartsFromServer: () => assert.fail('must stop on failed todos'),
    _markServerDocumentHydrated: () => assert.fail('must not acknowledge failed load'),
  });
  vm.runInContext(extract('_loadFromServer'), c);
  assert.equal(await c._loadFromServer(), false);
  assert.equal(c.window._serverHydratedEtag, 'old');
  assert.equal(c.window._remoteServerDocumentChanged, true);
  assert.equal(c._todoPagesStaleForServerEtag('new'), true);
});
