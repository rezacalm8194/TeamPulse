const router = require('express').Router();
const { randomUUID } = require('crypto');
const db = require('../config/database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  try {
    const { client_id, status } = req.query;
    let q = 'SELECT p.*, c.name as client_name FROM payments p LEFT JOIN clients c ON p.client_id=c.id WHERE p.account_id=?';
    const params = [req.user.id];
    if (client_id) { q += ' AND p.client_id=?'; params.push(client_id); }
    if (status) { q += ' AND p.status=?'; params.push(status); }
    q += ' ORDER BY p.created_at DESC';
    res.json(db.prepare(q).all(...params));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, (req, res) => {
  try {
    const { client_id, amount, type, status, description, due_date, paid_at } = req.body;
    if (!client_id || !amount) return res.status(400).json({ error: 'client_id and amount required' });
    const id = randomUUID();
    db.prepare('INSERT INTO payments (id,account_id,client_id,amount,type,status,description,due_date,paid_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, req.user.id, client_id, amount, type||'cash', status||'paid', description||null, due_date||null, paid_at||new Date().toISOString());
    if (status === 'paid') {
      db.prepare('UPDATE clients SET wallet_balance=wallet_balance+?, updated_at=datetime("now") WHERE id=? AND account_id=?').run(amount, client_id, req.user.id);
    }
    res.status(201).json(db.prepare('SELECT * FROM payments WHERE id=?').get(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, (req, res) => {
  try {
    const p = db.prepare('SELECT * FROM payments WHERE id=? AND account_id=?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    db.prepare('DELETE FROM payments WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/summary', auth, (req, res) => {
  try {
    const total = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE account_id=? AND status="paid"').get(req.user.id);
    const monthly = db.prepare('SELECT strftime("%Y-%m",created_at) as month, COALESCE(SUM(amount),0) as total FROM payments WHERE account_id=? AND status="paid" GROUP BY month ORDER BY month DESC LIMIT 12').all(req.user.id);
    res.json({ total_income: total.total, monthly });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
