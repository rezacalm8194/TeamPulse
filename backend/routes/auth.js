const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = require('../config/database');
const { sign } = require('../utils/jwt');
const auth = require('../middleware/auth');
const {
  ensureTokenRevocationSchema,
  currentTokenVersion,
  bumpTokenVersion,
  revokeJti,
  purgeExpiredRevokedTokens,
} = require('../utils/tokenRevocation');
const { ensureTeamAccessSchema, normalizeWorkspaceId, workspaceStorageKey } = require('../utils/teamAccessSchema');
const { loadWorkspaceMeta, loadDocumentParts } = require('../utils/documentStore');
const { logger } = require('../utils/logger');

ensureTeamAccessSchema(db);
ensureTokenRevocationSchema(db);
try { db.exec('ALTER TABLE accounts ADD COLUMN phone TEXT'); } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_phone_unique ON accounts(phone) WHERE phone IS NOT NULL AND phone<>''"); } catch {}

function normalizeIranPhone(value) {
  let phone = String(value || '').trim().replace(/[^0-9+]/g, '');
  if (phone.startsWith('+98')) phone = '0' + phone.slice(3);
  else if (phone.startsWith('0098')) phone = '0' + phone.slice(4);
  else if (/^9\d{9}$/.test(phone)) phone = '0' + phone;
  return /^09\d{9}$/.test(phone) ? phone : '';
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

router.post('/register', async (req, res) => {
  try {
    const { name, password, business_name, business_type } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = normalizeIranPhone(req.body.phone);
    if (!name || !email || !password || !phone)
      return res.status(400).json({ error: 'name, email, phone, password required' });
    if (password.length < 8) return res.status(400).json({ error: 'password too short' });
    const exists = db.prepare('SELECT id FROM accounts WHERE lower(email)=?').get(email);
    if (exists) return res.status(409).json({ error: 'email already exists' });
    const id = randomUUID();
    const hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO accounts (id,name,email,phone,password,business_name,business_type) VALUES (?,?,?,?,?,?,?)').run(id, name, email, phone, hash, business_name||null, business_type||null);
    const token = sign({ id, tv: currentTokenVersion(db, id) });
    logger.info('registration_success', { requestId: req.requestId, userId: id });
    res.status(201).json({ token, user: { id, name, email, phone, business_name, role: 'owner' } });
  } catch (e) {
    logger.error('registration_failed', { requestId: req.requestId, error: e });
    if (String(e.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'email already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const password = req.body.password;
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !password)
      return res.status(400).json({ error: 'email and password required' });
    // Legacy databases may contain case-only duplicate emails because the old
    // UNIQUE constraint was case-sensitive. Check each candidate's existing
    // hash and prefer the oldest matching account; never rewrite a password.
    const candidates = db.prepare(`
      SELECT * FROM accounts
      WHERE lower(trim(email))=? AND is_active=1
      ORDER BY datetime(created_at) ASC, rowid ASC
    `).all(email);
    let user = null;
    for (const candidate of candidates) {
      if (await bcrypt.compare(password, candidate.password)) {
        user = candidate;
        break;
      }
    }
    if (!user) {
      logger.warn('login_failed', { requestId: req.requestId, ip: req.ip, reason: 'invalid_credentials' });
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const token = sign({ id: user.id, tv: currentTokenVersion(db, user.id) });
    logger.info('login_success', { requestId: req.requestId, userId: user.id, ip: req.ip });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone || '', business_name: user.business_name, role: user.role } });
  } catch (e) {
    logger.error('login_error', { requestId: req.requestId, error: e });
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', auth, (req, res) => {
  try {
    const user = db.prepare('SELECT id,name,email,phone,business_name,business_type,role,plan,created_at FROM accounts WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/team-invite/grant', auth, (req, res) => {
  try {
    const workspaceId = normalizeWorkspaceId(req.body?.accountId || 'default');
    const memberEmail = String(req.body?.email || '').trim().toLowerCase();
    const inviteId = String(req.body?.inviteId || '').trim();
    const staffId = String(req.body?.staffId || '').trim();
    const permissions = normalizeTeamPermissions(req.body?.permissions);
    const instructionFolders = Array.isArray(req.body?.instructionFolders) ? req.body.instructionFolders : [];
    if (!workspaceId || !memberEmail.includes('@') || !inviteId || !permissions.length) {
      return res.status(400).json({ error: 'invalid team grant' });
    }
    if (workspaceId !== 'default') {
      const workspace = db.prepare('SELECT 1 FROM account_workspaces WHERE owner_account_id=? AND workspace_id=?').get(req.user.id, workspaceId);
      if (!workspace) return res.status(404).json({ error: 'workspace_not_found' });
    }
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
    `).run(req.user.id, workspaceId, memberEmail, staffId, inviteId,
      JSON.stringify(permissions), JSON.stringify(instructionFolders));
    logger.audit('permission_changed', {
      requestId: req.requestId, actorUserId: req.user.id, targetUserId: null,
      entityType: 'team_access_grant', entityId: inviteId,
      metadata: { workspaceId, action: 'granted', permissionKeys: permissions },
    });
    res.json({ success: true, permissions, instructionFolders });
  } catch (e) {
    logger.error('permission_change_failed', { requestId: req.requestId, userId: req.user.id, error: e });
    res.status(500).json({ error: e.message });
  }
});

router.post('/logout', auth, (req, res) => {
  try {
    revokeJti(db, { jti: req.user.jti, accountId: req.user.id, exp: req.user.exp });
    purgeExpiredRevokedTokens(db);
    logger.info('logout', { requestId: req.requestId, userId: req.user.id, ip: req.ip });
    res.json({ success: true });
  } catch (e) {
    logger.error('logout_failed', { requestId: req.requestId, userId: req.user.id, error: e });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/team-invite/grant', auth, (req, res) => {
  try {
    const workspaceId = normalizeWorkspaceId(req.body?.accountId || 'default');
    const memberEmail = String(req.body?.email || '').trim().toLowerCase();
    if (!workspaceId || !memberEmail) return res.status(400).json({ error: 'invalid team grant' });
    db.prepare(`
      INSERT INTO team_access_grants
        (owner_account_id,workspace_id,member_email,permissions,instruction_folders,status,updated_at)
      VALUES (?, ?, ?, '[]', '[]', 'revoked', datetime('now'))
      ON CONFLICT(owner_account_id,workspace_id,member_email) DO UPDATE SET
        status='revoked', updated_at=datetime('now')
    `).run(req.user.id, workspaceId, memberEmail);
    logger.audit('permission_changed', {
      requestId: req.requestId, actorUserId: req.user.id, targetUserId: null,
      entityType: 'team_access_grant', entityId: workspaceId,
      metadata: { workspaceId, action: 'revoked' },
    });
    res.json({ success: true });
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

    const storedGrant = db.prepare(`
      SELECT member_email,staff_id,invite_id,permissions,instruction_folders
      FROM team_access_grants
      WHERE owner_account_id=? AND workspace_id=? AND member_email=? AND status='active'
    `).get(owner.id, workspaceId, memberEmail);
    if (storedGrant && inviteId && storedGrant.invite_id && String(storedGrant.invite_id) !== inviteId) {
      return res.status(403).json({ error: 'team access not allowed' });
    }
    const storageKey = workspaceStorageKey(owner.id, workspaceId);
    const meta = loadWorkspaceMeta(db, storageKey);
    let members = [];
    if (meta?.layout === 'parts') {
      members = loadDocumentParts(db, storageKey, ['team_members']).collections.team_members || [];
    } else if (meta?.serialized) {
      try {
        const parsed = JSON.parse(meta.serialized);
        members = Array.isArray(parsed?.team_members) ? parsed.team_members : [];
      } catch {}
    }
    let member = storedGrant ? {
      id: storedGrant.invite_id,
      email: storedGrant.member_email,
      staff_id: storedGrant.staff_id,
      permissions: (() => { try { return JSON.parse(storedGrant.permissions || '[]'); } catch { return []; } })(),
      instruction_folders: (() => { try { return JSON.parse(storedGrant.instruction_folders || '[]'); } catch { return []; } })()
    } : members.find(m => {
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

router.put('/password', auth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || String(new_password || '').length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    const user = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'not found' });
    if (!await bcrypt.compare(current_password, user.password))
      return res.status(401).json({ error: 'current password wrong' });
    const hash = await bcrypt.hash(new_password, 10);
    const tv = db.transaction(() => {
      db.prepare('UPDATE accounts SET password=?, updated_at=datetime("now") WHERE id=?').run(hash, req.user.id);
      return bumpTokenVersion(db, req.user.id);
    })();
    const token = sign({ id: req.user.id, tv });
    res.json({ success: true, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/phone', auth, async (req, res) => {
  try {
    const phone = normalizeIranPhone(req.body.phone);
    const currentPassword = String(req.body.current_password || '');
    if (!phone) return res.status(400).json({ error: 'invalid phone' });
    const user = db.prepare('SELECT password FROM accounts WHERE id=?').get(req.user.id);
    if (!user || !await bcrypt.compare(currentPassword, user.password)) {
      return res.status(401).json({ error: 'current password wrong' });
    }
    db.prepare('UPDATE accounts SET phone=?,updated_at=datetime("now") WHERE id=?').run(phone, req.user.id);
    res.json({ success: true, phone });
  } catch (e) {
    if (String(e.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'phone already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
