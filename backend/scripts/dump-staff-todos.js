#!/usr/bin/env node
/**
 * Usage (on Pachim, from repo root):
 *   node backend/scripts/dump-staff-todos.js <accountId>
 *
 * Prints assignee todos: id, assignee, done, date, repeat, snapshot.
 */
const path = require('path');
const accountId = String(process.argv[2] || '').trim();
if (!accountId || accountId === 'OID') {
  console.error('Usage: node backend/scripts/dump-staff-todos.js <accountId>');
  process.exit(1);
}
process.chdir(path.join(__dirname, '..', '..'));
const db = require('../config/database');
const { loadAllTodos } = require('../utils/todoStore');
const todos = loadAllTodos(db, accountId).filter(t => t && (t.assignee_id || t.staff_id));
todos.forEach(t => {
  const id = t.id;
  const assignee = t.assignee_id || t.staff_id || '-';
  const done = t.done ? 1 : 0;
  const date = t.date_jalali || t.scheduled_date || '';
  const repeat = t.repeat || 'none';
  const snap = (t._snapshot || t._occurrence) ? 1 : 0;
  const archived = t.archived ? 1 : 0;
  console.log([id, assignee, done, date, repeat, snap, archived, String(t.title || '').slice(0, 40)].join('\t'));
});
console.error('rows=' + todos.length);
