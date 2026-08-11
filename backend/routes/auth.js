const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = require('../config/database');
const { sign } = require('../utils/jwt');
const auth = require('../middleware/auth');
const { ensureTeamAccessSchema, normalizeWorkspaceId, workspaceStorageKey } = require('../utils/teamAccessSchema');

ensureTeamAccessSchema(db);

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

router.post('/register', (req, res) => {
  try {
    const { name, password, business_name, business_type } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!name || !email || !password)
      return res.status(400).json({ error: 'name, email, password required' });
    const exists = db.prepare('SELECT id FROM accounts WHERE lower(email)=?').get(email);
    if (exists) return res.status(409).json({ error: 'email already exists' });
    const id = randomUUID();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO accounts (id,name,email,password,business_name,business_type) VALUES (?,?,?,?,?,?)').run(id, name, email, hash, business_name||null, business_type||null);
    const token = sign({ id, email, role: 'owner' });
    res.status(201).json({ token, user: { id, name, email, business_name, role: 'owner' } });
  } catch (e) {
    if (String(e.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'email already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

router.post('/login', (req, res) => {
  try {
    const password = req.body.password;
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !password)
      return res.status(400).json({ error: 'email and password required' });
    const user = db.prepare('SELECT * FROM accounts WHERE lower(email)=? AND is_active=1').get(email);
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'invalid credentials' });
    const token = sign({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, business_name: user.business_name, role: user.role } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', auth, (req, res) => {
  try {
    const user = db.prepare('SELECT id,name,email,business_name,business_type,role,plan,created_at FROM accounts WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/team-invite/resolve', auth, (req, res) => {
  try {
    const ownerUserId = String(req.body?.ownerUserId || '').trim();
    const ownerEmail = String(req.body?.ownerEmail || '').trim().toLowerCase();
    const inviteId = String(req.body?.inviteId || '').trim();
    const invitedEmail = String(req.body?.email || '').trim().toLowerCase();
    const memberEmail = String(req.user.email || '').trim().toLowerCase();
    const workspaceId = normalizeWorkspaceId(req.body?.accountId || 'default');
    if ((!ownerEmail && !ownerUserId) || !memberEmail) return res.status(400).json({ error: 'owner required' });
    if (!workspaceId) return res.status(400).json({ error: 'invalid_workspace' });
    if (invitedEmail && invitedEmail !== memberEmail) return res.status(403).json({ error: 'invite email mismatch' });

    const owner = ownerUserId
      ? db.prepare('SELECT id,name,email FROM accounts WHERE id=? AND is_active=1').get(ownerUserId)
      : db.prepare('SELECT id,name,email FROM accounts WHERE lower(email)=? AND is_active=1').get(ownerEmail);
    if (!owner) return res.status(404).json({ error: 'owner not found' });
    if (ownerEmail && String(owner.email || '').trim().toLowerCase() !== ownerEmail) {
      return res.status(403).json({ error: 'owner email mismatch' });
    }
    if (workspaceId !== 'default') {
      const workspace = db.prepare('SELECT 1 FROM account_workspaces WHERE owner_account_id=? AND workspace_id=?').get(owner.id, workspaceId);
      if (!workspace) return res.status(404).json({ error: 'workspace_not_found' });
    }

    const row = db.prepare("SELECT data FROM user_data WHERE account_id=?").get(workspaceStorageKey(owner.id, workspaceId));
    let data = null;
    try { data = row?.data ? JSON.parse(row.data) : null; } catch {}
    const members = Array.isArray(data?.team_members) ? data.team_members : [];
    let member = members.find(m => {
      const sameEmail = String(m.email || '').trim().toLowerCase() === memberEmail;
      const sameInvite = !inviteId || String(m.id || '').trim() === inviteId;
      return sameEmail && sameInvite && m.status !== 'حذف‌شده';
    });
    if (!member && inviteId) {
      member = members.find(m =>
        String(m.email || '').trim().toLowerCase() === memberEmail &&
        m.status !== 'حذف‌شده'
      );
    }
    // The owner document is the only authority for team access. Never create a
    // grant from permissions supplied by the invitee's browser.
    if (!member) return res.status(403).json({ error: 'team access not allowed' });

    const permissions = normalizeTeamPermissions(member.permissions);
    const staffId = String(member.staff_id || member.staffId || '').trim();
    const roleKey = String(member.role_key || member.roleKey || member.team_role || 'staff_basic').trim();
    member.permissions = permissions;

    db.prepare(`
      INSERT INTO team_access_grants
        (owner_account_id, workspace_id, member_email, staff_id, invite_id, permissions, instruction_folders, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
      ON CONFLICT(owner_account_id, workspace_id, member_email) DO UPDATE SET
        staff_id=excluded.staff_id,
        invite_id=excluded.invite_id,
        permissions=excluded.permissions,
        instruction_folders=excluded.instruction_folders,
        status='active',
        updated_at=datetime('now')
    `).run(
      owner.id,
      workspaceId,
      memberEmail,
      staffId,
      inviteId || String(member.id || ''),
      JSON.stringify(permissions),
      JSON.stringify(member.instruction_folders || member.instructionFolders || [])
    );

    res.json({
      ownerUserId: owner.id,
      ownerName: owner.name || '',
      ownerEmail: owner.email || '',
      accountId: workspaceId,
      staffId,
      roleKey,
      permissions,
      instructionFolders: member.instruction_folders || member.instructionFolders || []
    });
  } catch (e) {
    if (String(e.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'email already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

router.put('/password', auth, (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const user = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.user.id);
    if (!bcrypt.compareSync(current_password, user.password))
      return res.status(401).json({ error: 'current password wrong' });
    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE accounts SET password=?, updated_at=datetime("now") WHERE id=?').run(hash, req.user.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
