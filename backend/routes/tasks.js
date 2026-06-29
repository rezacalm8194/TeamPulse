const router = require('express').Router();
const { randomUUID } = require('crypto');
const db = require('../config/database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  try {
    const { status } = req.query;
    let q = 'SELECT * FROM tasks WHERE account_id=?';
    const params = [req.user.id];
    if (status) { q += ' AND status=?'; params.push(status); }
    q += ' ORDER BY due_date ASC, created_at DESC';
    res.json(db.prepare(q).all(...params));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, (req, res) => {
  try {
    const { title, description, priority, status, due_date, client_id } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const id = randomUUID();
    db.prepare('INSERT INTO tasks (id,account_id,client_id,title,description,priority,status,due_date) VALUES (?,?,?,?,?,?,?,?)').run(id, req.user.id, client_id||null, title, description||null, priority||'medium', status||'open', due_date||null);
    res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', auth, (req, res) => {
  try {
    const { title, description, priority, status, due_date } = req.body;
    db.prepare('UPDATE tasks SET title=?,description=?,priority=?,status=?,due_date=?,updated_at=datetime("now") WHERE id=? AND account_id=?').run(title, description||null, priority||'medium', status||'open', due_date||null, req.params.id, req.user.id);
    res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, (req, res) => {
  try {
    db.prepare('DELETE FROM tasks WHERE id=? AND account_id=?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
