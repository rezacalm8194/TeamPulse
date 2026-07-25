const router = require('express').Router();
const { randomUUID } = require('crypto');
const db = require('../config/database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  try {
    const { search, status, archived } = req.query;
    let q = 'SELECT * FROM clients WHERE account_id=?';
    const p = [req.user.id];
    q += archived === 'true' ? ' AND is_archived=1' : ' AND is_archived=0';
    if (status) { q += ' AND status=?'; p.push(status); }
    if (search) { q += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)'; p.push(`%${search}%`,`%${search}%`,`%${search}%`); }
    q += ' ORDER BY created_at DESC';
    res.json(db.prepare(q).all(...p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, (req, res) => {
  try {
    const { name, phone, email, domain, goal, status, tags, notes, custom_fields } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = randomUUID();
    db.prepare('INSERT INTO clients (id,account_id,name,phone,email,domain,goal,status,tags,notes,custom_fields) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, req.user.id, name, phone||null, email||null, domain||null, goal||null, status||'active', JSON.stringify(tags||[]), notes||null, JSON.stringify(custom_fields||{}));
    res.status(201).json(db.prepare('SELECT * FROM clients WHERE id=?').get(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', auth, (req, res) => {
  try {
    const c = db.prepare('SELECT * FROM clients WHERE id=? AND account_id=?').get(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', auth, (req, res) => {
  try {
    const c = db.prepare('SELECT id FROM clients WHERE id=? AND account_id=?').get(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const { name, phone, email, domain, goal, status, tags, notes, custom_fields } = req.body;
    db.prepare('UPDATE clients SET name=?,phone=?,email=?,domain=?,goal=?,status=?,tags=?,notes=?,custom_fields=?,updated_at=datetime("now") WHERE id=?').run(name, phone||null, email||null, domain||null, goal||null, status||'active', JSON.stringify(tags||[]), notes||null, JSON.stringify(custom_fields||{}), req.params.id);
    res.json(db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, (req, res) => {
  try {
    db.prepare('UPDATE clients SET is_archived=1,updated_at=datetime("now") WHERE id=? AND account_id=?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/restore', auth, (req, res) => {
  try {
    db.prepare('UPDATE clients SET is_archived=0,updated_at=datetime("now") WHERE id=? AND account_id=?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
