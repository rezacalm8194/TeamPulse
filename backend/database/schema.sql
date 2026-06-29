PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- حساب‌های کاربری (هر کوچ یک account)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'owner',
  business_name TEXT,
  business_type TEXT,
  plan TEXT DEFAULT 'free',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- پرسنل و همکاران
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  role TEXT DEFAULT 'staff',
  password TEXT,
  salary_type TEXT DEFAULT 'fixed',
  salary_amount REAL DEFAULT 0,
  commission_percent REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- مشتریان / شاگردان
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  staff_id TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  domain TEXT,
  goal TEXT,
  status TEXT DEFAULT 'active',
  tags TEXT DEFAULT '[]',
  wallet_balance REAL DEFAULT 0,
  notes TEXT,
  custom_fields TEXT DEFAULT '{}',
  is_archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- پرداخت‌های ورودی (از مشتری)
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  amount REAL NOT NULL,
  type TEXT DEFAULT 'cash',
  status TEXT DEFAULT 'paid',
  description TEXT,
  due_date TEXT,
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- پرداخت‌های خروجی (به پرسنل)
CREATE TABLE IF NOT EXISTS staff_payments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  amount REAL NOT NULL,
  type TEXT DEFAULT 'salary',
  description TEXT,
  paid_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- جلسات کوچینگ
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  staff_id TEXT,
  title TEXT,
  session_date TEXT,
  duration_minutes INTEGER DEFAULT 60,
  type TEXT DEFAULT 'online',
  status TEXT DEFAULT 'done',
  notes TEXT,
  homework TEXT,
  amount REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- وظایف / Todo
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'open',
  due_date TEXT,
  reminder_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- یادآوری‌های پرداخت
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  payment_id TEXT,
  message TEXT,
  remind_at TEXT NOT NULL,
  is_sent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- فایل‌های آپلودشده
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT,
  filename TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT,
  size INTEGER,
  path TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- رویدادهای Sync
CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT,
  device_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  synced_at TEXT
);

-- ایندکس‌ها برای سرعت
CREATE INDEX IF NOT EXISTS idx_clients_account ON clients(account_id);
CREATE INDEX IF NOT EXISTS idx_payments_account ON payments(account_id);
CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_tasks_account ON tasks(account_id);
CREATE INDEX IF NOT EXISTS idx_sync_account ON sync_events(account_id);
