const router = require('express').Router();
const { randomUUID } = require('crypto');
const db = require('../config/database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  try {
    const { client_id } = req.query;
    let q = 'SELECT s.*, c.name as client_name FROM sessions s LEFT JOIN clients c ON s.client_id=c.id WHERE s.account_id=?';
    const params = [req.user.id];
    if (client_id) { q += ' AND s.client_id=?'; params.push(client_id); }
    q += ' ORDER BY s.session_date DESC';
    res.json(db.prepare(q).all(...params));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, (req, res) => {
  try {
    const { client_id, title, session_date, duration_minutes, type, status, notes, homework, amount } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    const id = randomUUID();
    db.prepare('INSERT INTO sessions (id,account_id,client_id,title,session_date,duration_minutes,type,status,notes,homework,amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, req.user.id, client_id, title||null, session_date||new Date().toISOString(), duration_minutes||60, type||'online', status||'done', notes||null, homework||null, amount||0);
    res.status(201).json(db.prepare('SELECT * FROM sessions WHERE id=?').get(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', auth, (req, res) => {
  try {
    const { title, session_date, duration_minutes, type, status, notes, homework, amount } = req.body;
    db.prepare('UPDATE sessions SET title=?,session_date=?,duration_minutes=?,type=?,status=?,notes=?,homework=?,amount=? WHERE id=? AND account_id=?').run(title||null, session_date||null, duration_minutes||60, type||'online', status||'done', notes||null, homework||null, amount||0, req.params.id, req.user.id);
    res.json(db.prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, (req, res) => {
  try {
    db.prepare('DELETE FROM sessions WHERE id=? AND account_id=?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
