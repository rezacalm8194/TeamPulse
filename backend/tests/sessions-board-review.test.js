const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const sessions = fs.readFileSync(path.join(root, 'app-sessions.js'), 'utf8');

function slice(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `markers not found: ${startMarker}`);
  return src.slice(start, end);
}

function freshnessCtx() {
  const ctx = {
    BUSINESS_PAGINATED_KEYS: ['students', 'sessions', 'payments'],
    window: { _tpCompleteWalkEtag: {}, _serverPartHashes: {}, _serverDataEtag: 'doc-1', _serverHydratedEtag: '', _tpSessionFetchedParts: new Set() },
    _businessPagingState: () => ({}),
    _businessPageOrder: () => 'asc',
  };
  vm.createContext(ctx);
  vm.runInContext(
    slice(app, 'window._tpCompleteWalkEtag = window._tpCompleteWalkEtag', 'async function _ensureCompleteBusinessParts')
      + '\nthis._tpBusinessPageStale=_tpBusinessPageStale;',
    ctx,
  );
  return ctx;
}

test('sessions pages stay current when only another part (todos) changed', () => {
  const ctx = freshnessCtx();
  ctx.window._serverPartHashes = { sessions: 'S1', todos: 'T2' };
  const paging = { fetchedEtag: 'doc-1', fetchedPartHash: 'S1' };
  assert.equal(ctx._tpBusinessPageStale('sessions', paging, 'doc-2'), false);
});

test('sessions pages are stale when the sessions part hash changed', () => {
  const ctx = freshnessCtx();
  ctx.window._serverPartHashes = { sessions: 'S2' };
  const paging = { fetchedEtag: 'doc-1', fetchedPartHash: 'S1' };
  assert.equal(ctx._tpBusinessPageStale('sessions', paging, 'doc-1'), true);
  // A status response's own hashes win over the cached ones.
  assert.equal(ctx._tpBusinessPageStale('sessions', paging, 'doc-1', { sessions: 'S1' }), false);
});

test('without part hashes the document etag decides, as before', () => {
  const ctx = freshnessCtx();
  assert.equal(ctx._tpBusinessPageStale('sessions', { fetchedEtag: 'doc-1' }, 'doc-2'), true);
  assert.equal(ctx._tpBusinessPageStale('sessions', { fetchedEtag: 'doc-1' }, 'doc-1'), false);
  ctx.window._serverPartHashes = { sessions: 'S1' };
  assert.equal(ctx._tpBusinessPageStale('sessions', { fetchedEtag: 'doc-1', fetchedPartHash: null }, 'doc-2'), true);
});

test('every business page staleness check uses the part-hash helper', () => {
  assert.doesNotMatch(app, /currentEtag !== paging\.fetchedEtag/);
  assert.doesNotMatch(app, /paging\.fetchedEtag !== etag/);
  const loader = slice(app, 'async function _loadBusinessPage(', 'async function _loadMoreBusiness(');
  assert.match(loader, /_tpBusinessPageStale\(collection, state, currentEtag\)/);
  assert.match(loader, /if \(startsWalk\) state\.fetchedPartHash = pageHash \|\| hashAtStart \|\| null;/);
  assert.match(app, /_businessPagesStaleForServerEtag\(status\.etag, status\.part_hashes\)/);
});

function orderCtx() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(slice(sessions, 'function _mergeSessionsBoardOrder(', 'async function saveSessionsOrder(') + '\nthis.m=_mergeSessionsBoardOrder;', ctx);
  return ctx.m;
}

test('reordering the first 8 columns keeps the hidden columns where they were', () => {
  const merge = orderCtx();
  const saved = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const visible = [2, 1, 3, 4, 5, 6, 7, 8];
  assert.deepEqual([...merge(saved, visible)], [2, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('reordering under a filter does not drop the other customers', () => {
  const merge = orderCtx();
  const saved = [1, 2, 3, 4, 5, 6];
  assert.deepEqual([...merge(saved, [5, 2])], [1, 5, 3, 4, 2, 6]);
});

test('new customers not yet in the saved order are appended', () => {
  const merge = orderCtx();
  assert.deepEqual([...merge([1, 2], [2, 1, 9])], [2, 1, 9]);
  assert.deepEqual([...merge([], [3, 1])], [3, 1]);
  assert.deepEqual([...merge(null, [3, 1])], [3, 1]);
});

test('board drag starts only from the handle and respects RTL', () => {
  const render = slice(sessions, 'async function renderSessions(', 'function toggleKeySessionsPanel(');
  assert.doesNotMatch(render, /draggable="true"/);
  assert.match(render, /class="scn-drag"/);
  const dd = slice(sessions, 'function initSessionsDragDrop(', 'function _mergeSessionsBoardOrder(');
  assert.match(dd, /rtl \? e\.clientX > mid : e\.clientX < mid/);
  assert.match(dd, /if \(!col\.draggable\) \{ e\.preventDefault\(\); return; \}/);
});

test('column header keeps every action, with archive last inside the ⋯ menu', () => {
  const render = slice(sessions, 'async function renderSessions(', 'function toggleKeySessionsPanel(');
  for (const fn of ['openTopics', 'openKeyEvents', 'openSessionsSummary', 'openEvaluation', 'archiveStudent', 'openAddSessionGeneral', 'openStudentFollowups']) {
    assert.match(render, new RegExp(fn + '\\('), fn);
  }
  const panel = slice(render, '<div class="scn-menu-panel">', '</details>');
  const lastButton = panel.lastIndexOf('<button');
  assert.match(panel.slice(lastButton), /archiveStudent\(/);
  assert.match(render, /اقدام باز<\/button>/);
});

test('customer name search ignores spaces between first and last name and Arabic letters', () => {
  const ctx = {};
  vm.createContext(ctx);
  const norm = app.slice(app.indexOf('function _tpSearchNormalize('), app.indexOf('\n}\n', app.indexOf('function _tpSearchNormalize(')) + 3);
  const match = slice(app, 'function _tpPersonNameMatches(', 'function filterAccountStudents(');
  vm.runInContext(norm + match + '\nthis.f=_tpPersonNameMatches;', ctx);
  const g = { name: 'رضا', lname: 'حسن تبار' };
  assert.equal(ctx.f(g, 'رضا حسن'), true);
  assert.equal(ctx.f(g, 'رضاحسن'), true);
  assert.equal(ctx.f(g, 'تبار'), true);
  assert.equal(ctx.f({ name: 'علی', lname: 'اسرافیلیان' }, 'علي'), true);
  assert.equal(ctx.f({ name: 'نفیسه', lname: 'اسرافیلیان' }, 'علی'), false);
  assert.match(sessions, /_tpPersonNameMatches\(g, search\)/);
  assert.match(slice(app, 'function filterAccountStudents(', 'function studentAccountChipBarHtml('), /_tpPersonNameMatches\(s, search\)/);
});

test('business page responses carry the collection hash read before the page', () => {
  const route = fs.readFileSync(path.join(root, 'backend', 'routes', 'data.js'), 'utf8');
  const i = route.indexOf('const partHash = collectionState(db, workspace.storageKey, collection)?.data_hash || null;');
  const j = route.indexOf('const page = loadRowsPage(db, workspace.storageKey, collection, {');
  assert.ok(i > 0 && j > i, 'hash is read before the page');
  assert.match(route, /total: Number\(state\?\.row_count \|\| 0\), part_hash: partHash,/);
  assert.match(route, /available_parts: availableParts, part_hashes: partHashes/);
});

test('client keeps the page hash and skips unchanged collections after a document change', () => {
  const loader = slice(app, 'async function _loadBusinessPage(', 'async function _loadMoreBusiness(');
  assert.match(loader, /if \(startsWalk\) state\.fetchedPartHash = pageHash \|\| hashAtStart \|\| null;/);
  const changed = slice(app, 'const changedBusinessKeys = businessKeys.filter(key => {', '});');
  assert.match(changed, /FINANCE_NEWEST_FIRST_KEYS\.includes\(key\)\) return true/);
  assert.match(changed, /!window\._tpSessionFetchedParts\?\.has\(key\)\) return true/);
  assert.match(changed, /_tpBusinessPageStale\(key, _businessPagingState\(key\), payload\.etag, payload\.part_hashes\)/);
  assert.doesNotMatch(app, /_reloadBusinessFirstPagesFromServer\(businessKeys, \{ reset: true \}\)/);
  assert.match(app, /window\._tpCompleteWalkEtag\[key\] = finalPaging\.fetchedPartHash \|\| _tpWalkFreshnessTarget\(key\);/);
});

test('board stores newly added customers at the end of the saved order (owner only, append-only)', () => {
  const render = slice(sessions, 'async function renderSessions(', 'function toggleKeySessionsPanel(');
  assert.match(render, /if \(missing\.length && !_teamAccessSession\(\)\)/);
  assert.match(render, /setOrder\(\[\.\.\.savedOrder, \.\.\.missing\.map\(g => g\.student_id\)\]\)/);
});

test('archive asks once and offers undo; undo does not run convert-to-customer automations', async () => {
  const confirm = slice(app, 'async function _archiveStudentWithBalanceConfirm(', 'const _TP_ARCHIVE_UNDO_MS');
  assert.equal((confirm.match(/tpConfirm\(/g) || []).length, 1);
  assert.match(confirm, /_tpShowUndoToast\(/);
  const undoSrc = slice(app, 'async function _undoArchiveStudent(', 'async function deleteStudent(');
  assert.doesNotMatch(undoSrc, /setArchived|_automationOnConvertToCustomer/);

  const calls = [];
  const ctx = {
    _db: { students: [{ id: 4, name: 'A', archived: true, last_activity_at: 'NEW', converted_from_archive_at: 'X' }] },
    _save: (...a) => calls.push(['save', ...a]),
    showToast: () => {},
    window: { api: { students: { getAll: async () => [] } } },
    refreshOpenStudentSurface: async () => calls.push(['refresh']),
    allStudents: [],
  };
  vm.createContext(ctx);
  vm.runInContext(undoSrc + '\nthis.u=_undoArchiveStudent;', ctx);
  const ok = await ctx.u(4, 'A', { last_activity_at: 'OLD', had_converted_at: false });
  const s = ctx._db.students[0];
  assert.equal(ok, true);
  assert.equal(s.archived, false);
  assert.equal(s.last_activity_at, 'OLD');
  assert.equal('converted_from_archive_at' in s, false);
  assert.ok(s.updated_at);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['save', true, { urgent: true }]));
  assert.equal(await ctx.u(4, 'A', null), false, 'second undo is a no-op');
});

test('untitled session cards show the first line of the note', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(slice(app, 'function _sessionCardText(', 'function _cleanPlaceholderAnswer(') + '\nthis.f=_sessionCardText;', ctx);
  assert.equal(JSON.stringify(ctx.f({ title: 'عنوان', note: 'یادداشت' })), JSON.stringify({ title: 'عنوان', rest: 'یادداشت', fromNote: false }));
  assert.equal(JSON.stringify(ctx.f({ title: '', note: '\n **حفظ ظاهر** کافی نیست\nخط دوم' })), JSON.stringify({ title: 'حفظ ظاهر کافی نیست', rest: 'خط دوم', fromNote: true }));
  assert.equal(JSON.stringify(ctx.f({ title: '', note: '<p>سلام</p><p>دوم</p>' })), JSON.stringify({ title: 'سلام', rest: 'دوم', fromNote: true }));
  assert.equal(ctx.f({ title: '', note: '' }).title, '');
  const long = ctx.f({ title: '', note: 'کلمه '.repeat(30) });
  assert.ok(long.title.endsWith('…') && long.title.length <= 71);
  const render = slice(sessions, 'async function renderSessions(', 'function toggleKeySessionsPanel(');
  assert.equal((render.match(/_sessionCardText\(s\)/g) || []).length, 2);
});

test('board fetches missing sessions in the background instead of a «more» button', () => {
  const render = slice(sessions, 'async function renderSessions(', 'function toggleKeySessionsPanel(');
  assert.doesNotMatch(render, /todo-show-more|_loadMoreBusiness/);
  assert.match(render, /const _sessMissing = !sessionPaging\.done && !\(_sessTotal > 0 && _sessLocal >= _sessTotal\);/);
  assert.match(render, /await _ensureCompleteBusinessParts\(\['sessions'\]\);/);
  assert.match(render, /_tpSessionsBoardWalkFailedAt/);
});
