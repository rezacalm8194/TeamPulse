const router = require('express').Router();
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  try {
    const staff = db.prepare('SELECT id,name,phone,email,role,salary_type,salary_amount,commission_percent,is_active,notes,created_at FROM staff WHERE account_id=?').all(req.user.id);
    res.json(staff);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, (req, res) => {
  try {
    const { name, phone, email, role, password, salary_type, salary_amount, commission_percent, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = randomUUID();
    const hash = password ? bcrypt.hashSync(password, 10) : null;
    db.prepare('INSERT INTO staff (id,account_id,name,phone,email,role,password,salary_type,salary_amount,commission_percent,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, req.user.id, name, phone||null, email||null, role||'staff', hash, salary_type||'fixed', salary_amount||0, commission_percent||0, notes||null);
    res.status(201).json(db.prepare('SELECT id,name,phone,email,role,salary_type,salary_amount,commission_percent,is_active,notes,created_at FROM staff WHERE id=?').get(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', auth, (req, res) => {
  try {
    const { name, phone, email, role, salary_type, salary_amount, commission_percent, notes, is_active } = req.body;
    db.prepare('UPDATE staff SET name=?,phone=?,email=?,role=?,salary_type=?,salary_amount=?,commission_percent=?,notes=?,is_active=?,updated_at=datetime("now") WHERE id=? AND account_id=?').run(name, phone||null, email||null, role||'staff', salary_type||'fixed', salary_amount||0, commission_percent||0, notes||null, is_active??1, req.params.id, req.user.id);
    res.json(db.prepare('SELECT id,name,phone,email,role,salary_type,salary_amount,commission_percent,is_active,notes FROM staff WHERE id=?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, (req, res) => {
  try {
    db.prepare('UPDATE staff SET is_active=0 WHERE id=? AND account_id=?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/payments', auth, (req, res) => {
  try {
    const payments = db.prepare('SELECT * FROM staff_payments WHERE staff_id=? AND account_id=? ORDER BY created_at DESC').all(req.params.id, req.user.id);
    res.json(payments);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/payments', auth, (req, res) => {
  try {
    const { amount, type, description } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const id = randomUUID();
    db.prepare('INSERT INTO staff_payments (id,account_id,staff_id,amount,type,description) VALUES (?,?,?,?,?,?)').run(id, req.user.id, req.params.id, amount, type||'salary', description||null);
    res.status(201).json(db.prepare('SELECT * FROM staff_payments WHERE id=?').get(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
