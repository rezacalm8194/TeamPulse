const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../config/database');
const auth = require('../middleware/auth');
const { createHash } = require('crypto');
const { ensureTeamAccessSchema, normalizeWorkspaceId, workspaceStorageKey } = require('../utils/teamAccessSchema');
const { logger } = require('../utils/logger');
const { diffTodos } = require('../utils/todoAudit');
const {
  enqueueTodoAuditEvents,
  flushPendingTodoAudits,
  getTodoHighWater,
  writeTodoHighWater,
  documentTodoHighWater,
  findTodoIdCollisions,
} = require('../utils/todoAuditStore');
const { applyDocumentPatch, candidateTodosFromPatch } = require('../utils/documentPatch');
const { mergeAndApplyDeletedItems } = require('../utils/deletedItems');
const { mergeOwnerTodosWithPrevious, pickMergedTodo } = require('../utils/todoMerge');
const {
  staffEmail,
  ownStaffRowsForGrant,
  ownStaffIdsForGrant,
  todoVisibleToTeamMember,
  mergeTodoTombstones,
  mergeAllowedTeamTodos,
  mergeAllowedTeamDocument,
  allowedTeamDocumentPatch,
  canWriteTeamStudents,
  TEAM_STUDENT_RELATED_COLLECTIONS,
} = require('../utils/teamTodoMerge');
const {
  MAX_VERSIONS_PER_WORKSPACE,
  ensureVersionSnapshotSchema,
  saveVersionSnapshot: persistVersionSnapshot,
  isVersionSnapshotDue,
  listVersionSummaries,
} = require('../utils/versionSnapshots');
const { createStorageDriver } = require('../utils/storage');
const { deleteStoredFiles } = require('../utils/fileStore');
const {
  ensureDocumentStoreSchema,
  loadWorkspaceMeta,
  loadWorkspaceMetaAsync,
  loadWorkspaceDocumentAsync,
  loadDocumentParts,
  loadDocumentPartsAsync,
  serializeWorkspaceDocumentAsync,
  writeWorkspaceDocumentAsync,
  deleteWorkspaceDocument,
} = require('../utils/documentStore');

function dataEtag(serialized) {
  return createHash('sha256').update(String(serialized || '')).digest('hex');
}

// Large workspaces can exceed an upstream proxy's body-size limit before the
// request reaches Express. Receive them as small authenticated JSON chunks and
// pass the reconstructed request through the exact same save validation.
// Keep only metadata in RAM; spill chunk bodies to temp files so a 200×600KB
// upload cannot pin ~120MB until TTL expiry.
const pendingChunkUploads = new Map();
const CHUNK_UPLOAD_TTL_MS = 10 * 60 * 1000;
const CHUNK_UPLOAD_DIR = path.join(os.tmpdir(), 'teampulse-chunk-uploads');
const CHUNK_PART_ENCODING = 'utf16le';

function chunkUploadDirForKey(key) {
  return path.join(CHUNK_UPLOAD_DIR, createHash('sha256').update(key).digest('hex'));
}

function removeChunkUploadDir(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

function discardChunkUpload(key, upload) {
  pendingChunkUploads.delete(key);
  removeChunkUploadDir(upload?.dir);
}

function cleanExpiredChunkUploads() {
  const cutoff = Date.now() - CHUNK_UPLOAD_TTL_MS;
  for (const [key, upload] of pendingChunkUploads) {
    if (upload.updatedAt < cutoff) discardChunkUpload(key, upload);
  }
  try {
    for (const name of fs.readdirSync(CHUNK_UPLOAD_DIR)) {
      const dir = path.join(CHUNK_UPLOAD_DIR, name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(dir).mtimeMs; } catch (_) { continue; }
      if (mtimeMs < cutoff) removeChunkUploadDir(dir);
    }
  } catch (_) { /* base dir may not exist yet */ }
}

function assembleChunkUpload(upload) {
  const assembledPath = path.join(upload.dir, 'assembled.json');
  const out = fs.openSync(assembledPath, 'w');
  try {
    for (let i = 0; i < upload.total; i++) {
      const buf = fs.readFileSync(path.join(upload.dir, `${i}.part`));
      fs.writeSync(out, buf);
    }
  } finally {
    fs.closeSync(out);
  }
  return fs.readFileSync(assembledPath, CHUNK_PART_ENCODING);
}

setInterval(cleanExpiredChunkUploads, 60 * 1000).unref();

ensureVersionSnapshotSchema(db);
ensureDocumentStoreSchema(db);

function saveVersionSnapshot(accountId, serializedData, { force = false } = {}) {
  return persistVersionSnapshot(db, accountId, serializedData, { force });
}
db.prepare(`
  CREATE TABLE IF NOT EXISTS account_workspaces (
    owner_account_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (owner_account_id, workspace_id)
  )
`).run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_account_workspaces_owner ON account_workspaces(owner_account_id, created_at)").run();
ensureTeamAccessSchema(db);

const DATA_ARRAY_KEYS = [
  'students',
  'packages',
  'payments',
  'sessions',
  'expenses',
  'families',
  'todos',
  'staff',
  'instructions',
  'team_members',
  'goals',
  'habits'
];

function dataItemCount(data) {
  if (!data || typeof data !== 'object') return 0;
  return DATA_ARRAY_KEYS.reduce((sum, key) => {
    const value = data[key];
    return sum + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

function looksLikeDestructiveOverwrite(previousData, nextData) {
  const previousCount = dataItemCount(previousData);
  const nextCount = dataItemCount(nextData);
  if (previousCount < 3) return false;
  if (nextCount === 0) return true;
  return previousCount >= 10 && nextCount < Math.ceil(previousCount * 0.1);
}

function sanitizeUserDataForStorage(data) {
  if (!data || typeof data !== 'object') return data;
  const clean = Array.isArray(data) ? [...data] : { ...data };
  delete clean._gdrive_token;
  delete clean._gdrive_token_expiry;
  delete clean._gcal_token;
  delete clean._gcal_token_expiry;
  delete clean._todoTombstones;
  return clean;
}

function canAccessWorkspace(req, targetId, workspaceId) {
  if (req.user.id === targetId || req.user.role === 'admin') return true;
  const requesterEmail = String(req.user.email || '').trim().toLowerCase();
  if (!requesterEmail) return false;
  const explicitGrant = db.prepare(`
    SELECT status FROM team_access_grants
    WHERE owner_account_id=? AND workspace_id=? AND member_email=?
  `).get(targetId, workspaceId, requesterEmail);
  if (explicitGrant) return explicitGrant.status === 'active';
  const member = memberFromWorkspaceData(targetId, workspaceId, requesterEmail);
  if (member !== undefined) return !!member;
  return false;
}

const MAX_WORKSPACES_PER_ACCOUNT = 5; // default + at most four additional businesses

function requestedWorkspaceId(req) {
  return normalizeWorkspaceId(req.query.workspace || req.body?.workspace || 'default');
}

function workspaceExists(ownerAccountId, workspaceId) {
  if (workspaceId === 'default') return true;
  return !!db.prepare(`
    SELECT 1 FROM account_workspaces WHERE owner_account_id=? AND workspace_id=?
  `).get(ownerAccountId, workspaceId);
}

function resolveWorkspace(req, res, targetId) {
  const workspaceId = requestedWorkspaceId(req);
  if (!workspaceId) {
    res.status(400).json({ error: 'invalid_workspace' });
    return null;
  }
  if (!workspaceExists(targetId, workspaceId)) {
    res.status(404).json({ error: 'workspace_not_found' });
    return null;
  }
  return { workspaceId, storageKey: workspaceStorageKey(targetId, workspaceId) };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const TODO_TEAM_PERMISSION_KEYS = [
  'todo_view_assigned',
  'todo_complete_own',
  'todo_report_own',
  'todo_view_shared',
  'todo_view_clients',
  'todo_create_self',
  'todo_create_others',
  'todo_edit_manager',
  'todo_delete',
  'todo_view_team',
  'todo_view_self_report',
  'todo_view_team_report',
  'todo_manage_staff'
];
const TODO_DEFAULT_STAFF_PERMISSIONS = [
  'todolist',
  'todo_view_assigned',
  'todo_complete_own',
  'todo_report_own',
  'todo_view_self_report',
  'todo_create_self'
];

function normalizeTeamPermissions(permissions) {
  const list = Array.isArray(permissions) ? [...new Set(permissions.filter(Boolean))] : [];
  if (list.some(key => TODO_TEAM_PERMISSION_KEYS.includes(key)) && !list.includes('todolist')) {
    list.unshift('todolist');
  }
  if (list.includes('todolist') && !list.some(key => TODO_TEAM_PERMISSION_KEYS.includes(key))) {
    TODO_DEFAULT_STAFF_PERMISSIONS.forEach(key => {
      if (!list.includes(key)) list.push(key);
    });
  }
  return list;
}

function memberFromWorkspaceData(targetId, workspaceId, memberEmail, inviteId = '') {
  const storageKey = workspaceStorageKey(targetId, workspaceId);
  const meta = loadWorkspaceMeta(db, storageKey);
  if (!meta) return undefined;
  try {
    const members = meta.layout === 'parts'
      ? (loadDocumentParts(db, storageKey, ['team_members']).collections.team_members || [])
      : (() => {
        const data = JSON.parse(meta.serialized || 'null');
        return Array.isArray(data?.team_members) ? data.team_members : [];
      })();
    let member = members.find(m => {
      const sameEmail = String(m.email || '').trim().toLowerCase() === memberEmail;
      const sameInvite = !inviteId || String(m.id || '').trim() === String(inviteId).trim();
      return sameEmail && sameInvite && m.status !== 'حذف‌شده';
    });
    if (!member && inviteId) {
      member = members.find(m =>
        String(m.email || '').trim().toLowerCase() === memberEmail &&
        m.status !== 'حذف‌شده'
      );
    }
    return member || null;
  } catch {
    return undefined;
  }
}

function keysNeededForPatch(patch, grant) {
  const keys = new Set();
  const collections = patch?.collections && typeof patch.collections === 'object' ? patch.collections : {};
  Object.keys(collections).forEach(key => keys.add(key));
  if (grant) {
    keys.add('todos');
    keys.add('staff');
    if (canWriteTeamStudents(grant.permissions)) {
      keys.add('students');
      TEAM_STUDENT_RELATED_COLLECTIONS.forEach(key => keys.add(key));
    }
  }
  const deletedItems = patch?.scalars?._deletedItems;
  if (deletedItems && typeof deletedItems === 'object' && !Array.isArray(deletedItems)) {
    Object.keys(deletedItems).forEach(key => keys.add(key));
  }
  return [...keys];
}

function getTeamGrant(req, targetId, workspaceId) {
  if (req.user.id === targetId || req.user.role === 'admin') return null;
  const requesterEmail = String(req.user.email || '').trim().toLowerCase();
  if (!requesterEmail) return null;
  const grant = db.prepare(`
    SELECT permissions, invite_id, staff_id
    FROM team_access_grants
    WHERE owner_account_id=? AND workspace_id=? AND member_email=? AND status='active'
  `).get(targetId, workspaceId, requesterEmail);
  if (!grant) {
    const member = memberFromWorkspaceData(targetId, workspaceId, requesterEmail);
    const permissions = normalizeTeamPermissions(member?.permissions || []);
    const staffId = String(member?.staff_id || member?.staffId || '').trim();
    return permissions.length ? { email: requesterEmail, permissions, staffId } : null;
  }
  const storedPermissions = normalizeTeamPermissions(parseJsonArray(grant.permissions));
  const member = memberFromWorkspaceData(targetId, workspaceId, requesterEmail, grant.invite_id);
  const currentPermissions = normalizeTeamPermissions(member?.permissions || []);
  const permissions = currentPermissions.length ? currentPermissions : storedPermissions;
  const staffId = String(member?.staff_id || member?.staffId || grant.staff_id || '').trim();
  return { email: requesterEmail, permissions, staffId };
}

function ownStaffRows(data, memberEmail) {
  const rows = Array.isArray(data?.staff) ? data.staff : [];
  return rows.filter(staff => staffEmail(staff) === memberEmail);
}

function staffRelatedToMember(row, ownStaffIds, memberEmail) {
  if (!row || typeof row !== 'object') return false;
  const ids = [
    row.staff_id,
    row.staffId,
    row.employee_id,
    row.employeeId,
    row.personnel_id,
    row.personnelId,
    row.user_id,
    row.userId,
    row.assignee_id,
    row.assigneeId
  ].filter(v => v != null).map(v => String(v));
  if (ids.some(id => ownStaffIds.has(id))) return true;
  const emails = [row.email, row.staff_email, row.staffEmail, row.assignee_email, row.assigneeEmail]
    .filter(Boolean)
    .map(v => String(v).trim().toLowerCase());
  return emails.includes(memberEmail);
}

function sanitizeDataForTeamMember(data, grant) {
  if (!grant || !data || typeof data !== 'object') return data;
  const clean = sanitizeUserDataForStorage(data);
  const permissions = grant.permissions || [];
  const memberEmail = grant.email;
  const ownStaff = ownStaffRowsForGrant(clean, grant);
  const ownStaffIds = ownStaffIdsForGrant(clean, grant);
  clean.todos = Array.isArray(clean.todos)
    ? clean.todos.filter(todo => todoVisibleToTeamMember(todo, memberEmail, permissions, ownStaffIds))
    : [];
  if (!permissions.includes('goals')) clean.goals = [];
  if (!permissions.includes('habits')) clean.habits = [];
  if (!permissions.includes('staff') && !permissions.includes('todo_manage_staff') && !permissions.includes('todo_view_team')) {
    clean.staff = ownStaff;
    ['staff_payments','staff_reminders','staff_adjustments','staff_monthly','staff_role_entries'].forEach(key => {
      clean[key] = Array.isArray(clean[key])
        ? clean[key].filter(row => staffRelatedToMember(row, ownStaffIds, memberEmail))
        : [];
    });
  }
  clean.team_members = [];
  clean.team_invites = [];
  return clean;
}

const persistLocks = new Map();

function withPersistLock(storageKey, fn) {
  const previous = persistLocks.get(storageKey) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  persistLocks.set(storageKey, next);
  return next.finally(() => {
    if (persistLocks.get(storageKey) === next) persistLocks.delete(storageKey);
  });
}

async function persistWorkspaceDocument(req, res, {
  storageKey,
  workspace,
  grant,
  data,
  force,
  baseEtag,
  existing,
  previousData,
  previousSerialized = null,
  previousLayout = 'blob',
  replaceAll = true,
  patched = false,
}) {
  return withPersistLock(storageKey, () => persistWorkspaceDocumentLocked(req, res, {
    storageKey,
    workspace,
    grant,
    data,
    force,
    baseEtag,
    existing,
    previousData,
    previousSerialized,
    previousLayout,
    replaceAll,
    patched,
  }));
}

async function persistWorkspaceDocumentLocked(req, res, {
  storageKey,
  workspace,
  grant,
  data,
  force,
  baseEtag,
  existing,
  previousData,
  previousSerialized = null,
  previousLayout = 'blob',
  replaceAll = true,
  patched = false,
}) {
  data = sanitizeUserDataForStorage(data);
  if (data) data._workspaceId = workspace.workspaceId;
  let todoChanges = [];
  let savedEtag = null;
  if (existing) {
    const currentEtag = existing.etag || (previousSerialized ? dataEtag(previousSerialized) : null);
    // Team-member writes are merged field-by-field below. Owner/admin writes
    // replace the full account document, so protect them from stale tabs or
    // another device silently overwriting a newer server version.
    // برای سند موجود، صاحب حساب باید دقیقاً مشخص کند تغییرات را روی کدام
    // نسخه سرور انجام داده است. نبودن base_etag هم مثل نسخه قدیمی است؛ وگرنه
    // یک تب تازه‌فعال‌شده یا دستگاه آفلاین می‌تواند کل داده جدید را عقب ببرد.
    // force فقط جایگزینی عمدیِ تقریباً خالی را اجازه می‌دهد، نه دور زدن etag.
    if (!grant && (!baseEtag || baseEtag !== currentEtag)) {
      const conflictDoc = previousLayout === 'parts'
        ? (await loadWorkspaceDocumentAsync(db, storageKey))?.data
        : previousData;
      return res.status(409).json({
        error: 'sync_conflict',
        message: 'Server data changed since this client loaded it.',
        data: sanitizeUserDataForStorage(conflictDoc),
        etag: currentEtag,
      });
    }
    if (grant) {
      data = mergeAllowedTeamDocument(previousData, data, grant);
    } else if (replaceAll || Array.isArray(previousData?.todos) || Array.isArray(data?.todos)) {
      data = mergeOwnerTodosWithPrevious(previousData, data);
      const previousTodoIds = (Array.isArray(previousData?.todos) ? previousData.todos : []).map(t => String(t.id));
      const nextTodoIds = new Set((Array.isArray(data?.todos) ? data.todos : []).map(t => String(t.id)));
      const removedTodoIds = previousTodoIds.filter(id => !nextTodoIds.has(id));
      data._todoTombstones = mergeTodoTombstones(previousData, [...nextTodoIds], removedTodoIds);
    }
    data = mergeAndApplyDeletedItems(previousData, data, { inferRemovals: !grant });
    if (data && typeof data === 'object') delete data._deletedTodoIds;
    if (!force && looksLikeDestructiveOverwrite(previousData, data)) {
      return res.status(409).json({
        error: 'destructive_overwrite_blocked',
        message: 'Refusing to overwrite existing account data with an almost empty payload.'
      });
    }
    const todoIdCollisions = findTodoIdCollisions(
      db,
      storageKey,
      previousData?.todos,
      data?.todos,
      { incomingHighWater: data?._todoIdHighWater }
    );
    if (todoIdCollisions.length) {
      return res.status(409).json({
        error: 'todo_id_collision',
        message: 'A new todo reused an historical numeric id.',
        todo_ids: todoIdCollisions,
        todo_id_high_water: getTodoHighWater(db, storageKey),
      });
    }
    data._todoIdHighWater = Math.max(getTodoHighWater(db, storageKey), documentTodoHighWater(data));
    data._workspaceId = workspace.workspaceId;
    todoChanges = diffTodos(previousData?.todos, data?.todos);
    if (isVersionSnapshotDue(db, storageKey)) {
      const previousBlob = previousSerialized || await serializeWorkspaceDocumentAsync(db, storageKey);
      persistVersionSnapshot(db, storageKey, previousBlob);
    }
    savedEtag = (await writeWorkspaceDocumentAsync(db, storageKey, data, { replaceAll })).etag;
    db.transaction(() => {
      writeTodoHighWater(db, storageKey, data._todoIdHighWater);
      enqueueTodoAuditEvents(db, storageKey, {
        requestId: req.requestId,
        actorUserId: req.user?.id,
      }, todoChanges);
    })();
  } else {
    data._todoIdHighWater = documentTodoHighWater(data);
    data._workspaceId = workspace.workspaceId;
    todoChanges = diffTodos([], data?.todos);
    savedEtag = (await writeWorkspaceDocumentAsync(db, storageKey, data, { replaceAll: true })).etag;
    db.transaction(() => {
      writeTodoHighWater(db, storageKey, data._todoIdHighWater);
      enqueueTodoAuditEvents(db, storageKey, {
        requestId: req.requestId,
        actorUserId: req.user?.id,
      }, todoChanges);
    })();
  }
  const saved = db.prepare("SELECT updated_at FROM user_data WHERE account_id=?").get(storageKey);
  // Document JSON/SQLite I/O runs on a worker connection; high-water and
  // audit rows commit together afterwards. File delivery is best-effort.
  void flushPendingTodoAudits(db, logger);
  return res.json({
    success: true,
    updated_at: saved?.updated_at || null,
    etag: savedEtag,
    todo_id_high_water: getTodoHighWater(db, storageKey),
    patched,
  });
}

async function handleSaveData(req, res) {
  try {
    const targetId = req.params.accountId;
    const workspace = resolveWorkspace(req, res, targetId);
    if (!workspace) return;
    if (!canAccessWorkspace(req, targetId, workspace.workspaceId)) return res.status(403).json({ error: 'forbidden' });
    const storageKey = workspace.storageKey;
    const grant = getTeamGrant(req, targetId, workspace.workspaceId);
    const { force, base_etag: baseEtag } = req.body;
    let data = sanitizeUserDataForStorage(req.body.data);
    if (!data) return res.status(400).json({ error: 'no data' });
    // Workspace identity is server-owned routing metadata. Never trust a client
    // to provide it and never store an unlabelled secondary document.
    data._workspaceId = workspace.workspaceId;
    const loaded = await loadWorkspaceDocumentAsync(db, storageKey);
    return persistWorkspaceDocument(req, res, {
      storageKey,
      workspace,
      grant,
      data,
      force,
      baseEtag,
      existing: loaded ? { etag: loaded.etag } : null,
      previousData: loaded?.data || null,
      previousSerialized: loaded?.serialized || null,
      previousLayout: loaded?.layout || 'blob',
      replaceAll: true,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function handleDocumentDelta(req, res) {
  try {
    const targetId = req.params.accountId;
    const workspace = resolveWorkspace(req, res, targetId);
    if (!workspace) return;
    if (!canAccessWorkspace(req, targetId, workspace.workspaceId)) return res.status(403).json({ error: 'forbidden' });
    const storageKey = workspace.storageKey;
    const grant = getTeamGrant(req, targetId, workspace.workspaceId);
    const { force, base_etag: baseEtag, collections, scalars } = req.body || {};
    const hasCollections = collections && typeof collections === 'object' && Object.keys(collections).length;
    const hasScalars = scalars && typeof scalars === 'object' && Object.keys(scalars).length;
    if (!hasCollections && !hasScalars) return res.status(400).json({ error: 'empty_patch' });
    const meta = await loadWorkspaceMetaAsync(db, storageKey);
    if (!meta) return res.status(409).json({ error: 'delta_requires_full_sync' });
    const patch = { collections: hasCollections ? collections : {}, scalars: hasScalars ? scalars : {} };
    const useParts = meta.layout === 'parts';
    let previousData;
    if (useParts) {
      previousData = (await loadDocumentPartsAsync(db, storageKey, keysNeededForPatch(patch, grant))).data;
    } else {
      try { previousData = JSON.parse(meta.serialized || 'null'); }
      catch { return res.status(500).json({ error: 'invalid_server_data' }); }
    }
    let data;
    if (grant) {
      data = applyDocumentPatch(previousData, allowedTeamDocumentPatch(patch, grant));
      data.todos = candidateTodosFromPatch(previousData, patch);
      data._deletedTodoIds = Array.isArray(patch.collections?.todos?.delete) ? patch.collections.todos.delete : [];
      data._lastSaved = patch.scalars?._lastSaved || previousData?._lastSaved;
    } else {
      data = applyDocumentPatch(previousData, patch);
    }
    data._workspaceId = workspace.workspaceId;
    return persistWorkspaceDocument(req, res, {
      storageKey,
      workspace,
      grant,
      data,
      force,
      baseEtag,
      existing: { etag: meta.etag },
      previousData,
      previousSerialized: meta.serialized,
      previousLayout: meta.layout,
      replaceAll: !useParts,
      patched: true,
    });
  } catch (e) {
    if (e && e.code === 'patch_too_large') return res.status(413).json({ error: 'patch_too_large' });
    res.status(500).json({ error: e.message });
  }
}

// sendBeacon cannot set Content-Type to application/json reliably (browsers
// coerce it to text/plain). Parse that body as JSON so the JWT can travel
// in the POST body instead of the query string.
router.use(express.json({ type: 'text/plain', limit: '10mb' }));
router.put('/:accountId', auth, handleSaveData);
router.post('/:accountId/delta', auth, handleDocumentDelta);
router.post('/:accountId/todos/delta', auth, async (req, res) => {
  try {
    const targetId = req.params.accountId;
    const workspace = resolveWorkspace(req, res, targetId);
    if (!workspace) return;
    if (!canAccessWorkspace(req, targetId, workspace.workspaceId)) return res.status(403).json({ error: 'forbidden' });
    const storageKey = workspace.storageKey;
    const grant = getTeamGrant(req, targetId, workspace.workspaceId);
    const operation = String(req.body?.operation || 'upsert');
    if (!['create', 'edit', 'complete', 'reopen', 'upsert', 'delete'].includes(operation)) {
      return res.status(400).json({ error: 'invalid_todo_operation' });
    }
    const incomingTodos = [];
    if (Array.isArray(req.body?.todos)) {
      req.body.todos.forEach(item => {
        const todo = sanitizeUserDataForStorage(item);
        if (todo && typeof todo === 'object' && todo.id != null) incomingTodos.push(todo);
      });
    }
    const incomingTodo = sanitizeUserDataForStorage(req.body?.todo);
    if (incomingTodo && typeof incomingTodo === 'object' && incomingTodo.id != null) {
      incomingTodos.push(incomingTodo);
    }
    if (!incomingTodos.length) return res.status(400).json({ error: 'invalid_todo' });
    const meta = await loadWorkspaceMetaAsync(db, storageKey);
    if (!meta) return res.status(409).json({ error: 'delta_requires_full_sync' });
    const useParts = meta.layout === 'parts';
    let previousData;
    if (useParts) {
      previousData = (await loadDocumentPartsAsync(db, storageKey, grant ? ['todos', 'staff'] : ['todos'])).data;
    } else {
      try { previousData = JSON.parse(meta.serialized); }
      catch { return res.status(500).json({ error: 'invalid_server_data' }); }
    }
    const currentEtag = meta.etag;
    const baseEtag = req.body?.base_etag || null;
    const previousTodos = Array.isArray(previousData.todos) ? previousData.todos : [];
    const primaryIncoming = incomingTodos[incomingTodos.length - 1];
    const oldTodo = previousTodos.find(todo => String(todo?.id) === String(primaryIncoming.id));

    const deletedTodoIds = operation === 'delete'
      ? [...new Set(incomingTodos.map(todo => String(todo.id)))]
      : [];
    const candidateById = new Map(previousTodos.map(todo => [String(todo?.id), todo]));
    if (operation !== 'delete') {
      incomingTodos.forEach(todo => {
        const id = String(todo.id);
        const previous = candidateById.get(id);
        candidateById.set(id, previous ? pickMergedTodo(todo, previous) : todo);
      });
    }
    const candidateTodos = [...candidateById.values()];
    let nextData = {
      ...previousData,
      todos: operation === 'delete'
        ? previousTodos.filter(todo => !deletedTodoIds.includes(String(todo?.id)))
        : candidateTodos,
      _lastSaved: Math.max(Date.now(), Number(previousData._lastSaved || 0)),
      _workspaceId: workspace.workspaceId,
    };
    if (operation === 'delete') nextData._deletedTodoIds = deletedTodoIds;
    if (grant) nextData = mergeAllowedTeamTodos(previousData, nextData, grant);
    else if (operation === 'delete') {
      nextData = mergeOwnerTodosWithPrevious(previousData, nextData);
      const nextTodoIds = (nextData.todos || []).map(todo => String(todo.id));
      const removedTodoIds = previousTodos
        .map(todo => String(todo?.id))
        .filter(id => id && !nextTodoIds.includes(id));
      nextData._todoTombstones = mergeTodoTombstones(previousData, nextTodoIds, removedTodoIds);
    }
    const savedTodo = (nextData.todos || []).find(todo => String(todo?.id) === String(primaryIncoming.id));
    if (operation === 'delete') {
      if (oldTodo && savedTodo) return res.status(403).json({ error: 'todo_operation_forbidden' });
    } else {
      if (!savedTodo) return res.status(403).json({ error: 'todo_operation_forbidden' });
      if (grant && oldTodo && JSON.stringify(primaryIncoming) !== JSON.stringify(oldTodo) &&
          JSON.stringify(savedTodo) === JSON.stringify(oldTodo)) {
        return res.status(403).json({ error: 'todo_operation_forbidden' });
      }
    }
    if (nextData && typeof nextData === 'object') delete nextData._deletedTodoIds;

    const todoIdCollisions = findTodoIdCollisions(
      db,
      storageKey,
      previousTodos,
      nextData.todos,
      { incomingHighWater: req.body?.todo_id_high_water }
    );
    if (todoIdCollisions.length) {
      return res.status(409).json({
        error: 'todo_id_collision',
        message: 'A new todo reused an historical numeric id.',
        todo_ids: todoIdCollisions,
        todo_id_high_water: getTodoHighWater(db, storageKey),
      });
    }

    nextData._todoIdHighWater = Math.max(getTodoHighWater(db, storageKey), documentTodoHighWater(nextData));
    const todoChanges = diffTodos(previousTodos, nextData.todos);
    let savedEtag = null;
    await withPersistLock(storageKey, async () => {
      if (isVersionSnapshotDue(db, storageKey)) {
        saveVersionSnapshot(storageKey, meta.serialized || await serializeWorkspaceDocumentAsync(db, storageKey));
      }
      savedEtag = (await writeWorkspaceDocumentAsync(db, storageKey, nextData, { replaceAll: !useParts })).etag;
      db.transaction(() => {
        writeTodoHighWater(db, storageKey, nextData._todoIdHighWater);
        enqueueTodoAuditEvents(db, storageKey, {
          requestId: req.requestId,
          actorUserId: req.user?.id,
        }, todoChanges);
      })();
    });
    const saved = db.prepare("SELECT updated_at FROM user_data WHERE account_id=?").get(storageKey);
    void flushPendingTodoAudits(db, logger);
    res.json({
      success: true,
      etag: savedEtag,
      updated_at: saved?.updated_at || null,
      todo_id_high_water: getTodoHighWater(db, storageKey),
      todo: savedTodo,
      server_changed: !baseEtag || baseEtag !== currentEtag,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/:accountId/chunks', auth, async (req, res) => {
  cleanExpiredChunkUploads();
  const accountId = String(req.params.accountId || '');
  const uploadId = String(req.body?.upload_id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  const index = Number(req.body?.index);
  const total = Number(req.body?.total);
  const chunk = typeof req.body?.chunk === 'string' ? req.body.chunk : '';
  if (!uploadId || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || total > 200 || index >= total || chunk.length > 600000) {
    return res.status(400).json({ error: 'invalid_chunk' });
  }
  const ownerKey = String(req.user?.id || req.user?.accountId || 'unknown');
  const key = `${ownerKey}:${accountId}:${uploadId}`;
  let upload = pendingChunkUploads.get(key);
  if (!upload) {
    const dir = chunkUploadDirForKey(key);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      logger.error('chunk_upload_dir_failed', { requestId: req.requestId, error: error.message });
      return res.status(500).json({ error: 'chunk_upload_failed' });
    }
    upload = { total, received: 0, seen: new Array(total).fill(false), dir, updatedAt: Date.now() };
    pendingChunkUploads.set(key, upload);
  }
  if (upload.total !== total) {
    discardChunkUpload(key, upload);
    return res.status(409).json({ error: 'chunk_total_mismatch' });
  }
  try {
    fs.writeFileSync(path.join(upload.dir, `${index}.part`), chunk, CHUNK_PART_ENCODING);
  } catch (error) {
    discardChunkUpload(key, upload);
    logger.error('chunk_upload_write_failed', { requestId: req.requestId, error: error.message });
    return res.status(500).json({ error: 'chunk_upload_failed' });
  }
  if (!upload.seen[index]) {
    upload.seen[index] = true;
    upload.received += 1;
  }
  upload.updatedAt = Date.now();
  if (upload.received !== total) {
    return res.json({ success: true, complete: false, received: index });
  }
  pendingChunkUploads.delete(key);
  try {
    req.body = JSON.parse(assembleChunkUpload(upload));
  } catch (error) {
    removeChunkUploadDir(upload.dir);
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'invalid_chunked_json' });
    logger.error('chunk_upload_assemble_failed', { requestId: req.requestId, error: error.message });
    return res.status(500).json({ error: 'chunk_upload_failed' });
  }
  removeChunkUploadDir(upload.dir);
  return handleSaveData(req, res);
});
// navigator.sendBeacon() only ever issues a POST, so the same save logic
// must also be reachable via POST for the "closing the tab" fallback save
// to actually reach the server (previously only PUT was registered here,
// so every beacon save silently failed with a 404 that the client could
// never see). Auth is the JSON body `token` field, never a query param.
router.post('/:accountId', auth, handleSaveData);

router.get('/:accountId/workspaces', auth, (req, res) => {
  const targetId = req.params.accountId;
  const isOwner = req.user.id === targetId || req.user.role === 'admin';
  const requesterEmail = String(req.user.email || '').trim().toLowerCase();
  const rows = isOwner
    ? db.prepare('SELECT workspace_id AS id,name,created_at AS created FROM account_workspaces WHERE owner_account_id=? ORDER BY created_at,id').all(targetId)
    : db.prepare(`
        SELECT w.workspace_id AS id,w.name,w.created_at AS created
        FROM account_workspaces w
        JOIN team_access_grants g ON g.owner_account_id=w.owner_account_id AND g.workspace_id=w.workspace_id
        WHERE w.owner_account_id=? AND g.member_email=? AND g.status='active'
        ORDER BY w.created_at,w.workspace_id
      `).all(targetId, requesterEmail);
  const hasDefault = isOwner || !!db.prepare(`SELECT 1 FROM team_access_grants WHERE owner_account_id=? AND workspace_id='default' AND member_email=? AND status='active'`).get(targetId, requesterEmail);
  if (!isOwner && !hasDefault && !rows.length) return res.status(403).json({ error: 'forbidden' });
  if (hasDefault) rows.unshift({ id:'default', name:'میزکار اصلی', created:null });
  res.json({ workspaces: rows, limit: MAX_WORKSPACES_PER_ACCOUNT });
});

router.post('/:accountId/workspaces', auth, (req, res) => {
  try {
    const targetId = req.params.accountId;
    if (req.user.id !== targetId && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const workspaceId = String(req.body?.id || '').trim();
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!/^acc_[a-zA-Z0-9_-]{6,80}$/.test(workspaceId) || !name) return res.status(400).json({ error: 'invalid_workspace' });
    const count = db.prepare('SELECT COUNT(*) AS n FROM account_workspaces WHERE owner_account_id=?').get(targetId).n;
    if (count >= MAX_WORKSPACES_PER_ACCOUNT - 1) return res.status(409).json({ error: 'workspace_limit', limit: MAX_WORKSPACES_PER_ACCOUNT });
    db.prepare(`INSERT INTO account_workspaces(owner_account_id,workspace_id,name) VALUES (?,?,?)`).run(targetId, workspaceId, name);
    res.status(201).json({ workspace: { id: workspaceId, name } });
  } catch(e) {
    if (String(e.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'workspace_exists' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:accountId/workspaces/:workspaceId', auth, (req, res) => {
  const targetId = req.params.accountId;
  if (req.user.id !== targetId && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'invalid_name' });
  const result = db.prepare(`UPDATE account_workspaces SET name=?,updated_at=datetime('now') WHERE owner_account_id=? AND workspace_id=?`).run(name, targetId, req.params.workspaceId);
  if (!result.changes) return res.status(404).json({ error: 'workspace_not_found' });
  res.json({ success: true });
});

router.delete('/:accountId/workspaces/:workspaceId', auth, (req, res) => {
  const targetId = req.params.accountId;
  if (req.user.id !== targetId && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const workspaceId = String(req.params.workspaceId || '');
  if (workspaceId === 'default') return res.status(400).json({ error: 'default_workspace' });
  const storageKey = workspaceStorageKey(targetId, workspaceId);
  const run = db.transaction(() => {
    const result = db.prepare('DELETE FROM account_workspaces WHERE owner_account_id=? AND workspace_id=?').run(targetId, workspaceId);
    if (!result.changes) return false;
    db.prepare('DELETE FROM team_access_grants WHERE owner_account_id=? AND workspace_id=?').run(targetId, workspaceId);
    try { db.prepare("DELETE FROM push_subscriptions WHERE account_id=? AND COALESCE(workspace_id,'default')=?").run(targetId, workspaceId); } catch {}
    db.prepare('DELETE FROM user_data_version_summaries WHERE account_id=?').run(storageKey);
    db.prepare('DELETE FROM user_data_versions WHERE account_id=?').run(storageKey);
    deleteWorkspaceDocument(db, storageKey);
    deleteStoredFiles(db, createStorageDriver(), { ownerAccountId: targetId, workspaceId });
    return true;
  });
  if (!run()) return res.status(404).json({ error: 'workspace_not_found' });
  res.json({ success: true });
});

// نسخه‌های سرور فقط با درخواست صریح کاربر فهرست/بازیابی می‌شوند؛ هیچ مسیر
// همگام‌سازی عادی اجازه ندارد خودکار یکی از این نسخه‌ها را برگرداند.
router.get('/:accountId/versions', auth, (req, res) => {
  try {
    const targetId = req.params.accountId;
    const workspace = resolveWorkspace(req, res, targetId);
    if (!workspace) return;
    if (!canAccessWorkspace(req, targetId, workspace.workspaceId)) return res.status(403).json({ error: 'forbidden' });
    const storageKey = workspace.storageKey;
    const limit = Math.min(MAX_VERSIONS_PER_WORKSPACE, Math.max(1, Number(req.query.limit || MAX_VERSIONS_PER_WORKSPACE)));
    res.json({ versions: listVersionSummaries(db, storageKey, limit) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:accountId/versions/:versionId/restore', auth, async (req, res) => {
  try {
    const targetId = req.params.accountId;
    // هم‌تیمی می‌تواند داده مجاز را ویرایش کند، اما بازگردانی کل حساب فقط برای
    // صاحب حساب یا مدیر و فقط با همین درخواست صریح مجاز است.
    if (req.user.id !== targetId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'restore_forbidden' });
    }
    const workspace = resolveWorkspace(req, res, targetId);
    if (!workspace) return;
    const storageKey = workspace.storageKey;
    const selected = db.prepare(
      'SELECT id,data FROM user_data_versions WHERE id=? AND account_id=?'
    ).get(req.params.versionId, storageKey);
    if (!selected) return res.status(404).json({ error: 'version_not_found' });
    if (!loadWorkspaceMeta(db, storageKey)) return res.status(404).json({ error: 'data_not_found' });
    let restored;
    try { restored = JSON.parse(selected.data); }
    catch { return res.status(422).json({ error: 'invalid_version_data' }); }
    restored = sanitizeUserDataForStorage(restored);
    restored._restored_at = new Date().toISOString();
    restored._lastSaved = Date.now();
    restored._todoIdHighWater = Math.max(getTodoHighWater(db, storageKey), documentTodoHighWater(restored));
    let savedEtag = null;
    await withPersistLock(storageKey, async () => {
      saveVersionSnapshot(storageKey, await serializeWorkspaceDocumentAsync(db, storageKey), { force:true });
      savedEtag = (await writeWorkspaceDocumentAsync(db, storageKey, restored, { replaceAll: true })).etag;
      writeTodoHighWater(db, storageKey, restored._todoIdHighWater);
    });
    res.json({ success: true, data: restored, etag: savedEtag });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:accountId/status', auth, async (req, res) => {
  try {
    const targetId = req.params.accountId;
    const workspace = resolveWorkspace(req, res, targetId);
    if (!workspace) return;
    if (!canAccessWorkspace(req, targetId, workspace.workspaceId)) return res.status(403).json({ error: 'forbidden' });
    const meta = await loadWorkspaceMetaAsync(db, workspace.storageKey);
    res.json({
      etag: meta?.etag || null,
      updated_at: meta?.updated_at || null,
      todo_id_high_water: getTodoHighWater(db, workspace.storageKey),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:accountId', auth, async (req, res) => {
  try {
    const targetId = req.params.accountId;
    const workspace = resolveWorkspace(req, res, targetId);
    if (!workspace) return;
    if (!canAccessWorkspace(req, targetId, workspace.workspaceId)) return res.status(403).json({ error: 'forbidden' });
    const loaded = await loadWorkspaceDocumentAsync(db, workspace.storageKey);
    if (!loaded) return res.json({ data: null });
    const grant = getTeamGrant(req, targetId, workspace.workspaceId);
    res.json({
      data: grant ? sanitizeDataForTeamMember(loaded.data, grant) : sanitizeUserDataForStorage(loaded.data),
      workspace_id: workspace.workspaceId,
      updated_at: loaded.updated_at,
      etag: loaded.etag,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
