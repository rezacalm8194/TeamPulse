const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = require('../config/database');
const { sign } = require('../utils/jwt');
const auth = require('../middleware/auth');

router.post('/register', (req, res) => {
  try {
    const { name, email, password, business_name, business_type } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'name, email, password required' });
    const exists = db.prepare('SELECT id FROM accounts WHERE email=?').get(email);
    if (exists) return res.status(409).json({ error: 'email already exists' });
    const id = randomUUID();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO accounts (id,name,email,password,business_name,business_type) VALUES (?,?,?,?,?,?)').run(id, name, email, hash, business_name||null, business_type||null);
    const token = sign({ id, email, role: 'owner' });
    res.status(201).json({ token, user: { id, name, email, business_name, role: 'owner' } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'email and password required' });
    const user = db.prepare('SELECT * FROM accounts WHERE email=? AND is_active=1').get(email);
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
