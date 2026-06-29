const router = require('express').Router();
const auth = require('../middleware/auth');
const db = require('../config/database');

router.get('/export', auth, (req, res) => {
  try {
    const accountId = req.user.id;
    const data = {
      meta: { version: '1.0.0', exported_at: new Date().toISOString(), account_id: accountId },
      account: db.prepare('SELECT id,name,email,business_name,business_type,plan,created_at FROM accounts WHERE id=?').get(accountId),
      clients: db.prepare('SELECT * FROM clients WHERE account_id=?').all(accountId),
      staff: db.prepare('SELECT id,name,phone,email,role,salary_type,salary_amount,commission_percent,is_active,notes,created_at FROM staff WHERE account_id=?').all(accountId),
      payments: db.prepare('SELECT * FROM payments WHERE account_id=?').all(accountId),
      staff_payments: db.prepare('SELECT * FROM staff_payments WHERE account_id=?').all(accountId),
      sessions: db.prepare('SELECT * FROM sessions WHERE account_id=?').all(accountId),
      tasks: db.prepare('SELECT * FROM tasks WHERE account_id=?').all(accountId),
      reminders: db.prepare('SELECT * FROM reminders WHERE account_id=?').all(accountId),
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=backup.json');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/import', auth, (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !data.meta) return res.status(400).json({ error: 'invalid backup file' });
    const accountId = req.user.id;
    const run = db.transaction(() => {
      let counts = { clients: 0, payments: 0, sessions: 0, tasks: 0 };
      if (data.clients) for (const c of data.clients) {
        db.prepare('INSERT OR IGNORE INTO clients (id,account_id,name,phone,email,domain,goal,status,tags,notes,custom_fields,wallet_balance,is_archived,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(c.id,accountId,c.name,c.phone||null,c.email||null,c.domain||null,c.goal||null,c.status||'active',c.tags||'[]',c.notes||null,c.custom_fields||'{}',c.wallet_balance||0,c.is_archived||0,c.created_at,c.updated_at);
        counts.clients++;
      }
      if (data.payments) for (const p of data.payments) {
        db.prepare('INSERT OR IGNORE INTO payments (id,account_id,client_id,amount,type,status,description,due_date,paid_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(p.id,accountId,p.client_id,p.amount,p.type||'cash',p.status||'paid',p.description||null,p.due_date||null,p.paid_at||null,p.created_at);
        counts.payments++;
      }
      if (data.sessions) for (const s of data.sessions) {
        db.prepare('INSERT OR IGNORE INTO sessions (id,account_id,client_id,title,session_date,duration_minutes,type,status,notes,homework,amount,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(s.id,accountId,s.client_id,s.title||null,s.session_date||null,s.duration_minutes||60,s.type||'online',s.status||'done',s.notes||null,s.homework||null,s.amount||0,s.created_at);
        counts.sessions++;
      }
      if (data.tasks) for (const t of data.tasks) {
        db.prepare('INSERT OR IGNORE INTO tasks (id,account_id,client_id,title,description,priority,status,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(t.id,accountId,t.client_id||null,t.title,t.description||null,t.priority||'medium',t.status||'open',t.due_date||null,t.created_at,t.updated_at);
        counts.tasks++;
      }
      return counts;
    });
    res.json({ success: true, imported: run() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;