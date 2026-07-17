const router = require('express').Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

db.prepare(`
  CREATE TABLE IF NOT EXISTS user_data_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_user_data_versions_account ON user_data_versions(account_id, created_at)").run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS team_access_grants (
    owner_account_id TEXT NOT NULL,
    member_email TEXT NOT NULL,
    invite_id TEXT,
    permissions TEXT DEFAULT '[]',
    instruction_folders TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (owner_account_id, member_email)
  )
`).run();

const DATA_ARRAY_KEYS = [
  'students',
  'packages',
  'payments',
  'sessions',
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
  return clean;
}

function canAccessAccount(req, targetId) {
  if (req.user.id === targetId || req.user.role === 'admin') return true;
  const requesterEmail = String(req.user.email || '').trim().toLowerCase();
  if (!requesterEmail) return false;
  const grant = db.prepare(`
    SELECT owner_account_id
    FROM team_access_grants
    WHERE owner_account_id=? AND member_email=? AND status='active'
  `).get(targetId, requesterEmail);
  if (grant) return true;
  const row = db.prepare("SELECT data FROM user_data WHERE account_id=?").get(targetId);
  if (!row?.data) return false;
  try {
    const data = JSON.parse(row.data);
    return (data.team_members || []).some(member =>
      String(member.email || '').trim().toLowerCase() === requesterEmail &&
      member.status !== 'حذف‌شده'
    );
  } catch {
    return false;
  }
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getTeamGrant(req, targetId) {
  if (req.user.id === targetId || req.user.role === 'admin') return null;
  const requesterEmail = String(req.user.email || '').trim().toLowerCase();
  if (!requesterEmail) return null;
  const grant = db.prepare(`
    SELECT permissions
    FROM team_access_grants
    WHERE owner_account_id=? AND member_email=? AND status='active'
  `).get(targetId, requesterEmail);
  return grant ? { email: requesterEmail, permissions: parseJsonArray(grant.permissions) } : null;
}

function todoSharedWith(todo) {
  if (Array.isArray(todo?.shared_with)) return todo.shared_with.map(String);
  if (Array.isArray(todo?.sharedWith)) return todo.sharedWith.map(String);
  return [];
}

function staffEmail(staff) {
  return String(staff?.email || staff?.work_email || staff?.username || '').trim().toLowerCase();
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

function todoAssignedToMember(todo, memberEmail, ownStaffIds = new Set()) {
  const emails = [todo?.assignee_email, todo?.assigneeEmail]
    .filter(Boolean)
    .map(v => String(v).trim().toLowerCase());
  if (emails.includes(memberEmail)) return true;
  const ids = [todo?.assignee_id, todo?.assigneeId, todo?.staff_id, todo?.staffId]
    .filter(v => v != null)
    .map(v => String(v));
  return ids.some(id => ownStaffIds.has(id));
}

function todoVisibleToTeamMember(todo, memberEmail, permissions, ownStaffIds = new Set()) {
  const visibility = todo?.visibility || (todo?.assignee_id ? 'assignee' : 'private');
  if (permissions.includes('todo_view_team') || permissions.includes('todo_manage_staff')) return true;
  if (permissions.includes('todo_view_assigned') && todoAssignedToMember(todo, memberEmail, ownStaffIds)) return true;
  if (permissions.includes('todo_view_shared') && todoSharedWith(todo).map(x => x.toLowerCase()).includes(memberEmail)) return true;
  if (permissions.includes('todo_view_clients') && String(todo?.category || '') === 'clients') return true;
  if (visibility === 'team' && permissions.includes('todo_view_shared')) return true;
  return false;
}

function sanitizeDataForTeamMember(data, grant) {
  if (!grant || !data || typeof data !== 'object') return data;
  const clean = sanitizeUserDataForStorage(data);
  const permissions = grant.permissions || [];
  const memberEmail = grant.email;
  const ownStaff = ownStaffRows(clean, memberEmail);
  const ownStaffIds = new Set(ownStaff.map(staff => String(staff.id)).filter(Boolean));
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

function mergeAllowedTeamTodos(previousData, nextData, grant) {
  if (!grant || !previousData || !nextData) return nextData;
  const memberEmail = grant.email;
  const permissions = grant.permissions || [];
  const previousTodos = Array.isArray(previousData.todos) ? previousData.todos : [];
  const incomingTodos = Array.isArray(nextData.todos) ? nextData.todos : [];
  const ownStaffIds = new Set(ownStaffRows(previousData, memberEmail).map(staff => String(staff.id)).filter(Boolean));
  const incomingById = new Map(incomingTodos.map(t => [String(t.id), t]));
  const nextTodos = previousTodos.map(oldTodo => {
    const incoming = incomingById.get(String(oldTodo.id));
    if (!incoming) return oldTodo;
    if (!todoVisibleToTeamMember(oldTodo, memberEmail, permissions, ownStaffIds)) return oldTodo;
    const assignedToMember = todoAssignedToMember(oldTodo, memberEmail, ownStaffIds);
    const canCompleteOwn = permissions.includes('todo_complete_own') && assignedToMember;
    const canReportOwn = permissions.includes('todo_report_own') && assignedToMember;
    const canEditManager = permissions.includes('todo_edit_manager');
    if (canEditManager) return { ...oldTodo, ...incoming };
    return {
      ...oldTodo,
      done: canCompleteOwn ? !!incoming.done : oldTodo.done,
      done_at: canCompleteOwn ? (incoming.done_at || null) : oldTodo.done_at,
      completedAt: canCompleteOwn ? (incoming.completedAt || incoming.done_at || null) : oldTodo.completedAt,
      completed_at: canCompleteOwn ? (incoming.completed_at || incoming.done_at || null) : oldTodo.completed_at,
      completed_by: canCompleteOwn ? (incoming.completed_by || memberEmail) : oldTodo.completed_by,
      completed_by_email: canCompleteOwn ? (incoming.completed_by_email || memberEmail) : oldTodo.completed_by_email,
      status: canCompleteOwn ? (incoming.status || oldTodo.status) : oldTodo.status,
      staff_report: canReportOwn ? (incoming.staff_report || oldTodo.staff_report || '') : oldTodo.staff_report,
      report_updated_at: canReportOwn ? (incoming.report_updated_at || oldTodo.report_updated_at || null) : oldTodo.report_updated_at,
      history: incoming.history || oldTodo.history,
      updated_at: incoming.updated_at || oldTodo.updated_at,
    };
  });
  if (permissions.includes('todo_create_self')) {
    incomingTodos.forEach(todo => {
      if (previousTodos.some(x => String(x.id) === String(todo.id))) return;
      if (!todoAssignedToMember(todo, memberEmail, ownStaffIds)) return;
      nextTodos.push(todo);
    });
  }
  return { ...previousData, todos: nextTodos, _lastSaved: nextData._lastSaved || previousData._lastSaved };
}

router.put('/:accountId', auth, (req, res) => {
  try {
    const targetId = req.params.accountId;
    if (!canAccessAccount(req, targetId)) return res.status(403).json({ error: 'forbidden' });
    const grant = getTeamGrant(req, targetId);
    const { force } = req.body;
    let data = sanitizeUserDataForStorage(req.body.data);
    if (!data) return res.status(400).json({ error: 'no data' });
    const existing = db.prepare("SELECT account_id,data FROM user_data WHERE account_id=?").get(targetId);
    if (existing) {
      let previousData = null;
      try { previousData = JSON.parse(existing.data || 'null'); } catch {}
      if (grant) data = mergeAllowedTeamTodos(previousData, data, grant);
      if (!force && looksLikeDestructiveOverwrite(previousData, data)) {
        return res.status(409).json({
          error: 'destructive_overwrite_blocked',
          message: 'Refusing to overwrite existing account data with an almost empty payload.'
        });
      }
      const nextData = JSON.stringify(data);
      const run = db.transaction(() => {
        db.prepare("INSERT INTO user_data_versions (account_id,data) VALUES (?,?)").run(targetId, existing.data);
        db.prepare("UPDATE user_data SET data=?,updated_at=datetime('now') WHERE account_id=?").run(nextData, targetId);
        db.prepare(`
          DELETE FROM user_data_versions
          WHERE account_id=?
            AND id NOT IN (
              SELECT id FROM user_data_versions
              WHERE account_id=?
              ORDER BY id DESC
              LIMIT 50
            )
        `).run(targetId, targetId);
      });
      run();
    } else {
      db.prepare("INSERT INTO user_data (account_id,data,updated_at) VALUES (?,?,datetime('now'))").run(targetId, JSON.stringify(data));
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:accountId', auth, (req, res) => {
  try {
    const targetId = req.params.accountId;
    if (!canAccessAccount(req, targetId)) return res.status(403).json({ error: 'forbidden' });
    const row = db.prepare("SELECT data,updated_at FROM user_data WHERE account_id=?").get(targetId);
    if (!row) return res.json({ data: null });
    const grant = getTeamGrant(req, targetId);
    const data = JSON.parse(row.data);
    res.json({ data: grant ? sanitizeDataForTeamMember(data, grant) : sanitizeUserDataForStorage(data), updated_at: row.updated_at });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
