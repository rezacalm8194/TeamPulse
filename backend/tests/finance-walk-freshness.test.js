const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extractFreshnessBlock() {
  const start = app.indexOf('window._tpCompleteWalkEtag = window._tpCompleteWalkEtag');
  const end = app.indexOf('async function _ensureCompleteBusinessParts', start);
  assert.ok(start > 0 && end > start);
  return app.slice(start, end);
}

function makeCtx(overrides = {}) {
  const BUSINESS_PAGINATED_KEYS = ['students', 'sessions', 'payments', 'packages', 'expenses', 'wallet_tx', 'reminders'];
  const ctx = {
    BUSINESS_PAGINATED_KEYS,
    window: {
      _tpCompleteWalkEtag: {},
      _serverPartHashes: {},
      _serverDataEtag: 'doc-etag-v1',
      _serverHydratedEtag: '',
      _tpSessionFetchedParts: new Set(),
    },
    _businessPagingState: () => ({ loading: false, done: true, search: '', order: 'desc' }),
    _businessPageOrder: () => 'desc',
    ...overrides,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFreshnessBlock() + '\nthis._businessPartCompleteAndFresh=_businessPartCompleteAndFresh;', ctx);
  return ctx;
}

test('sessions stay fresh when only todos part hash changes', () => {
  const ctx = makeCtx();
  ctx.window._serverPartHashes = { sessions: 'sess-h1', todos: 'todo-h2' };
  ctx.window._tpCompleteWalkEtag = { sessions: 'sess-h1' };
  ctx.window._tpSessionFetchedParts.add('sessions');
  assert.equal(ctx._businessPartCompleteAndFresh('sessions'), true);
  ctx.window._serverPartHashes.todos = 'todo-h3';
  ctx.window._serverDataEtag = 'document-etag-wholly-different';
  assert.equal(ctx._businessPartCompleteAndFresh('sessions'), true);
});

test('sessions require re-walk when sessions part hash changes', () => {
  const ctx = makeCtx();
  ctx.window._serverPartHashes = { sessions: 'sess-h1' };
  ctx.window._tpCompleteWalkEtag = { sessions: 'sess-h1' };
  ctx.window._tpSessionFetchedParts.add('sessions');
  assert.equal(ctx._businessPartCompleteAndFresh('sessions'), true);
  ctx.window._serverPartHashes.sessions = 'sess-h2';
  assert.equal(ctx._businessPartCompleteAndFresh('sessions'), false);
});

test('without part_hashes compare walk marker to document etag', () => {
  const ctx = makeCtx();
  ctx.window._serverPartHashes = {};
  ctx.window._tpCompleteWalkEtag = { payments: 'doc-etag-v1' };
  ctx.window._tpSessionFetchedParts.add('payments');
  assert.equal(ctx._businessPartCompleteAndFresh('payments'), true);
  ctx.window._serverDataEtag = 'doc-etag-v2';
  assert.equal(ctx._businessPartCompleteAndFresh('payments'), false);
});

test('walk completion stores part hash not document etag when available', () => {
  assert.match(app, /window\._tpCompleteWalkEtag\[key\] = _tpWalkFreshnessTarget\(key\)/);
  assert.match(app, /_tpBusinessPartHash\(key\) \|\| _tpCurrentServerEtag\(\)/);
});

test('own delta can bump walk marker when part_hashes confirm no external drift', () => {
  const ctx = makeCtx();
  vm.runInContext(extractFreshnessBlock() + '\nthis._tpRefreshWalkMarkersAfterOwnDelta=_tpRefreshWalkMarkersAfterOwnDelta;', ctx);
  ctx.window._tpCompleteWalkEtag = { payments: 'pay-before' };
  ctx._tpRefreshWalkMarkersAfterOwnDelta(
    { collections: { payments: { upsert: [] } } },
    { part_hashes: { payments: 'pay-after' } },
  { markers: { payments: 'pay-before' }, partHashes: { payments: 'pay-before' } },
  );
  assert.equal(ctx.window._tpCompleteWalkEtag.payments, 'pay-after');
});

test('asset version tp442', () => {
  assert.match(app, /const TP_ASSET_V = 'tp442'/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /team-pulse-static-v436/);
});