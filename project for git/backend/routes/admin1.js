const router = require('express').Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

router.get('/stats', auth, adminOnly, (req, res) => {
  try {
    const users = db.prepare("SELECT a.id,a.name,a.email,a.role,a.plan,a.is_active,a.created_at,(SELECT COUNT(*) FROM clients WHERE account_id=a.id) as client_count,(SELECT COALESCE(SUM(amount),0) FROM payments WHERE account_id=a.id AND status='paid') as total_income FROM accounts a ORDER BY a.created_at DESC").all();
    res.json({ userCount: users.length, users: users.map(u=>({...u,wallet:u.total_income})), chargeReqs:[], settings:{card_number:'',daily_cost:1000,tutorial_video_url:''} });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id/role', auth, adminOnly, (req, res) => {
  try {
    db.prepare("UPDATE accounts SET role=?,updated_at=datetime('now') WHERE id=?").run(req.body.role, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id/status', auth, adminOnly, (req, res) => {
  try {
    db.prepare("UPDATE accounts SET is_active=?,updated_at=datetime('now') WHERE id=?").run(req.body.is_active?1:0, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/users/:id', auth, adminOnly, (req, res) => {
  try {
    const user = db.prepare("SELECT id,name,email,role,plan,is_active,created_at FROM accounts WHERE id=?").get(req.params.id);
    if (!user) return res.status(404).json({ error: 'not found' });
    const clients = db.prepare("SELECT * FROM clients WHERE account_id=? AND is_archived=0").all(req.params.id);
    const payments = db.prepare("SELECT * FROM payments WHERE account_id=? ORDER BY created_at DESC LIMIT 20").all(req.params.id);
    res.json({ user, clients, payments });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/settings', auth, adminOnly, (req, res) => res.json({ success: true }));
router.post('/charge-requests/:id/approve', auth, adminOnly, (req, res) => res.json({ success: true }));
router.post('/charge-requests/:id/reject', auth, adminOnly, (req, res) => res.json({ success: true }));


router.delete('/users/:id', auth, adminOnly, (req, res) => {
  try {
    const targetId = req.params.id;
    // جلوگیری از حذف ادمین اصلی
    const target = db.prepare("SELECT email FROM accounts WHERE id=?").get(targetId);
    if (!target) return res.status(404).json({ error: 'not found' });
    if (target.email === 'rezasafarinet1@gmail.com') {
      return res.status(403).json({ error: 'cannot delete main admin' });
    }
    // حذف همه داده‌های کاربر
    db.prepare("DELETE FROM clients WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM payments WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM sessions WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM tasks WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM staff WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM reminders WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM user_data WHERE account_id=?").run(targetId);
    db.prepare("DELETE FROM accounts WHERE id=?").run(targetId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;