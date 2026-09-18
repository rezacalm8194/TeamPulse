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
  'todo_manage_staff',
];

const TODO_DEFAULT_STAFF_PERMISSIONS = [
  'todolist',
  'todo_view_assigned',
  'todo_complete_own',
  'todo_report_own',
  'todo_view_self_report',
  'todo_create_self',
];

const TEAM_ROLE_PRESET_PERMISSIONS = {
  staff_basic: TODO_DEFAULT_STAFF_PERMISSIONS.slice(),
  assistant_manager: [
    'students', 'sessions', 'customerlist', 'calendar', 'reminders', 'todolist',
    'todo_view_assigned', 'todo_complete_own', 'todo_report_own', 'todo_view_self_report',
    'todo_view_clients', 'todo_view_shared', 'todo_create_self', 'todo_create_others', 'todo_edit_manager',
  ],
  task_manager: [
    'todolist', 'staff',
    'todo_view_assigned', 'todo_complete_own', 'todo_report_own', 'todo_view_self_report',
    'todo_view_team', 'todo_view_team_report', 'todo_create_self', 'todo_create_others',
    'todo_edit_manager', 'todo_delete', 'todo_manage_staff',
  ],
};

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

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pickResolvedTeamPermissions(documentPermissions, grantPermissions, roleKey) {
  const fromDoc = normalizeTeamPermissions(documentPermissions);
  const fromGrant = normalizeTeamPermissions(
    Array.isArray(grantPermissions) ? grantPermissions : parseJsonArray(grantPermissions)
  );
  if (fromDoc.length) return fromDoc;
  if (fromGrant.length) return fromGrant;
  const role = String(roleKey || 'staff_basic').trim() || 'staff_basic';
  if (role === 'custom') return [];
  return normalizeTeamPermissions(TEAM_ROLE_PRESET_PERMISSIONS[role] || TODO_DEFAULT_STAFF_PERMISSIONS);
}

module.exports = {
  TODO_TEAM_PERMISSION_KEYS,
  TODO_DEFAULT_STAFF_PERMISSIONS,
  TEAM_ROLE_PRESET_PERMISSIONS,
  normalizeTeamPermissions,
  parseJsonArray,
  pickResolvedTeamPermissions,
};
