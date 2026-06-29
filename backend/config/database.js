const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', process.env.DB_PATH || './database/teampulse.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
