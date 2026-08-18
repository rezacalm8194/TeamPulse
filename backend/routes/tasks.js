const router = require('express').Router();
const { randomUUID } = require('crypto');
const db = require('../config/database');
const auth = require('../middleware/auth');
const { logger } = require('../utils/logger');

function ensureTaskChecklistSchema() {
  const cols = new Set(db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name));
  const add = (name, sql) => { if (!cols.has(name)) db.prepare(`ALTER TABLE tasks ADD COLUMN ${name} ${sql}`).run(); };
  add('owner_id', 'TEXT');
  add('created_by', 'TEXT');
  add('assignee_id', 'TEXT');
  add('workspace_id', 'TEXT');
  add('visibility', "TEXT DEFAULT 'private'");
  add('shared_with', "TEXT DEFAULT '[]'");
  add('manager_note', 'TEXT');
  add('due_time', 'TEXT');
  add('requires_report', "TEXT DEFAULT 'none'");
  add('requires_attachment', "TEXT DEFAULT 'none'");
  add('requires_approval', 'INTEGER DEFAULT 0');
  add('staff_report', 'TEXT');
  add('report_updated_at', 'TEXT');
  add('completed_by', 'TEXT');
  add('completed_at', 'TEXT');
  add('recurrence_rule', 'TEXT');
  add('occurrence_date', 'TEXT');
  db.prepare(`
    CREATE TABLE IF NOT EXISTS task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_occurrence ON tasks(occurrence_date)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id)").run();
  db.prepare("UPDATE tasks SET visibility='private' WHERE visibility IS NULL OR visibility=''").run();
}

ensureTaskChecklistSchema();

function parseShared(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function canReadTask(req, task) {
  if (!task) return false;
  if (task.account_id === req.user.id || req.user.role === 'admin') return true;
  const email = String(req.user.email || '').toLowerCase();
  if (task.assignee_id === req.user.id || String(task.assignee_email || '').toLowerCase() === email) return true;
  return parseShared(task.shared_with).map(x => x.toLowerCase()).includes(email);
}

function canManageTask(req, task) {
  return task && (task.account_id === req.user.id || task.created_by === req.user.id || req.user.role === 'admin');
}

function addHistory(taskId, userId, action, oldValue, newValue) {
  db.prepare('INSERT INTO task_history (task_id,user_id,action,old_value,new_value) VALUES (?,?,?,?,?)')
    .run(taskId, userId || null, action, oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue));
}

router.get('/', auth, (req, res) => {
  try {
    const { status, assignee_id } = req.query;
    let q = 'SELECT * FROM tasks WHERE account_id=?';
    const params = [req.user.id];
    if (status) { q += ' AND status=?'; params.push(status); }
    if (assignee_id) { q += ' AND assignee_id=?'; params.push(assignee_id); }
    q += ' ORDER BY due_date ASC, created_at DESC';
    res.json(db.prepare(q).all(...params).filter(t => canReadTask(req, t)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, (req, res) => {
  try {
    const { title, description, manager_note, priority, status, due_date, due_time, client_id, assignee_id, visibility, shared_with, requires_report, requires_attachment, requires_approval, recurrence_rule, occurrence_date } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const id = randomUUID();
    db.prepare(`INSERT INTO tasks
      (id,account_id,owner_id,created_by,client_id,assignee_id,visibility,shared_with,title,description,manager_note,priority,status,due_date,due_time,requires_report,requires_attachment,requires_approval,recurrence_rule,occurrence_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.user.id, req.user.id, req.user.id, client_id||null, assignee_id||null, visibility||'private', JSON.stringify(shared_with||[]), title, description||null, manager_note||description||null, priority||'medium', status||'open', due_date||null, due_time||null, requires_report||'none', requires_attachment||'none', requires_approval?1:0, recurrence_rule||null, occurrence_date||due_date||null);
    addHistory(id, req.user.id, 'created', null, req.body);
    logger.audit('task_created', {
      requestId: req.requestId, actorUserId: req.user.id, targetUserId: assignee_id || null,
      entityType: 'task', entityId: id, metadata: { status: status || 'open' },
    });
    if (assignee_id) logger.audit('task_assigned', {
      requestId: req.requestId, actorUserId: req.user.id, targetUserId: assignee_id,
      entityType: 'task', entityId: id, metadata: {},
    });
    res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', auth, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
    if (!canReadTask(req, existing)) return res.status(404).json({ error: 'not found' });
    const canManage = canManageTask(req, existing);
    const canComplete = existing.assignee_id === req.user.id || canManage;
    if (!canManage && !canComplete) return res.status(403).json({ error: 'forbidden' });
    const next = { ...existing, ...req.body };
    if (!canManage) {
      ['title','description','manager_note','priority','due_date','due_time','assignee_id','visibility','shared_with','requires_report','requires_attachment','requires_approval','recurrence_rule','occurrence_date'].forEach(k => { next[k] = existing[k]; });
    }
    db.prepare(`UPDATE tasks SET title=?,description=?,manager_note=?,priority=?,status=?,due_date=?,due_time=?,assignee_id=?,visibility=?,shared_with=?,requires_report=?,requires_attachment=?,requires_approval=?,staff_report=?,report_updated_at=?,completed_by=?,completed_at=?,recurrence_rule=?,occurrence_date=?,updated_at=datetime("now") WHERE id=?`)
      .run(next.title, next.description||null, next.manager_note||null, next.priority||'medium', next.status||'open', next.due_date||null, next.due_time||null, next.assignee_id||null, next.visibility||'private', JSON.stringify(next.shared_with||parseShared(next.shared_with)), next.requires_report||'none', next.requires_attachment||'none', next.requires_approval?1:0, next.staff_report||null, next.report_updated_at||null, next.completed_by||null, next.completed_at||null, next.recurrence_rule||null, next.occurrence_date||next.due_date||null, req.params.id);
    addHistory(req.params.id, req.user.id, 'updated', existing, next);
    const changedFields = Object.keys(req.body).filter(key => String(existing[key] ?? '') !== String(next[key] ?? ''));
    logger.audit('task_updated', {
      requestId: req.requestId, actorUserId: req.user.id, targetUserId: next.assignee_id || null,
      entityType: 'task', entityId: req.params.id, metadata: { changedFields },
    });
    if (String(existing.assignee_id || '') !== String(next.assignee_id || '')) logger.audit('task_assigned', {
      requestId: req.requestId, actorUserId: req.user.id, targetUserId: next.assignee_id || null,
      entityType: 'task', entityId: req.params.id, metadata: { previousTargetUserId: existing.assignee_id || null },
    });
    if (String(existing.status || '') !== String(next.status || '')) logger.audit('task_status_changed', {
      requestId: req.requestId, actorUserId: req.user.id, targetUserId: next.assignee_id || null,
      entityType: 'task', entityId: req.params.id, metadata: { from: existing.status, to: next.status },
    });
    res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
    if (!canManageTask(req, existing)) return res.status(403).json({ error: 'forbidden' });
    db.prepare('DELETE FROM tasks WHERE id=? AND account_id=?').run(req.params.id, req.user.id);
    addHistory(req.params.id, req.user.id, 'deleted', existing, null);
    logger.audit('task_deleted', {
      requestId: req.requestId, actorUserId: req.user.id, targetUserId: existing.assignee_id || null,
      entityType: 'task', entityId: req.params.id, metadata: {},
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
