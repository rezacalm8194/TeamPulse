const assert = require('assert');

const today = '1405/04/24';
const yesterday = '1405/04/23';
let nextId = 10;

function rootId(t) {
  return t.recurrence_parent_id || t.id;
}

function makeSnapshot(db, t, status, completedAt = '2026-07-15T08:00:00.000Z') {
  const scheduledDate = t.scheduled_date || t.date_jalali;
  const done = status === 'completed' || status === 'late_completed';
  const snap = {
    ...t,
    id: nextId++,
    recurrence_parent_id: rootId(t),
    scheduled_date: scheduledDate,
    date_jalali: scheduledDate,
    repeat: 'none',
    done,
    done_at: done ? completedAt : null,
    completedAt: done ? completedAt : null,
    status,
    archived: true,
    _snapshot: true,
  };
  db.todos.push(snap);
  return snap;
}

function advanceDaily(t, fromDate) {
  t.recurrence_parent_id = rootId(t);
  t.date_jalali = fromDate === yesterday ? today : '1405/04/25';
  t.scheduled_date = t.date_jalali;
  t.done = false;
  t.done_at = null;
  t.status = 'pending';
  t.archived = false;
}

function completeOccurrence(db, id) {
  const t = db.todos.find(x => x.id === id);
  const scheduledDate = t.scheduled_date || t.date_jalali;
  const status = scheduledDate < today ? 'late_completed' : 'completed';
  if (t.repeat && t.repeat !== 'none') {
    makeSnapshot(db, t, status);
    advanceDaily(t, scheduledDate);
  } else {
    t.done = true;
    t.done_at = '2026-07-15T08:00:00.000Z';
    t.completedAt = t.done_at;
    t.status = status;
  }
}

function skipOccurrence(db, id) {
  const t = db.todos.find(x => x.id === id);
  makeSnapshot(db, t, 'skipped');
  advanceDaily(t, t.scheduled_date || t.date_jalali);
}

function deleteOccurrence(db, id) {
  const t = db.todos.find(x => x.id === id);
  advanceDaily(t, t.scheduled_date || t.date_jalali);
}

function editOnlyOccurrence(db, id, patch) {
  const t = db.todos.find(x => x.id === id);
  db.todos.push({
    ...t,
    ...patch,
    id: nextId++,
    recurrence_parent_id: rootId(t),
    repeat: 'none',
    scheduled_date: patch.date_jalali || t.scheduled_date || t.date_jalali,
    done: false,
    archived: false,
    status: 'pending',
    _occurrence: true,
  });
  advanceDaily(t, t.scheduled_date || t.date_jalali);
}

function activeForDate(db, date) {
  return db.todos.filter(t => !t.archived && (t.scheduled_date || t.date_jalali) === date);
}

function snapshotsForDate(db, date, status) {
  return db.todos.filter(t => t.archived && t._snapshot && (t.scheduled_date || t.date_jalali) === date && (!status || t.status === status));
}

{
  const db = { todos: [{ id: 1, title: 'daily', date_jalali: yesterday, scheduled_date: yesterday, repeat: 'daily', done: false, archived: false }] };
  completeOccurrence(db, 1);
  assert.strictEqual(snapshotsForDate(db, yesterday, 'late_completed').length, 1, 'yesterday occurrence is completed late');
  assert.strictEqual(activeForDate(db, today).length, 1, 'today occurrence remains active');
  assert.strictEqual(activeForDate(db, today)[0].done, false, 'today occurrence remains pending');
}

{
  const db = { todos: [{ id: 2, title: 'daily', date_jalali: yesterday, scheduled_date: yesterday, repeat: 'daily', done: false, archived: false }] };
  completeOccurrence(db, 2);
  completeOccurrence(db, 2);
  assert.strictEqual(snapshotsForDate(db, yesterday, 'late_completed').length, 1, 'late occurrence completed once');
  assert.strictEqual(snapshotsForDate(db, today, 'completed').length, 1, 'today occurrence completed separately');
  assert.strictEqual(activeForDate(db, '1405/04/25').length, 1, 'chain advances after today is completed');
}

{
  const db = { todos: [{ id: 3, title: 'daily', date_jalali: yesterday, scheduled_date: yesterday, repeat: 'daily', done: false, archived: false }] };
  completeOccurrence(db, 3);
  completeOccurrence(db, 3);
  assert.strictEqual(new Set(db.todos.map(t => `${rootId(t)}:${t.scheduled_date || t.date_jalali}:${t.status || 'pending'}`)).size, db.todos.length, 'no duplicate occurrence records');
}

{
  const db = { todos: [{ id: 4, title: 'daily', date_jalali: yesterday, scheduled_date: yesterday, repeat: 'daily', done: false, archived: false }] };
  skipOccurrence(db, 4);
  assert.strictEqual(snapshotsForDate(db, yesterday, 'skipped').length, 1, 'skipped is kept in history');
  assert.strictEqual(activeForDate(db, today).length, 1, 'skip does not remove today');
}

{
  const db = { todos: [{ id: 5, title: 'daily', date_jalali: yesterday, scheduled_date: yesterday, repeat: 'daily', done: false, archived: false }] };
  deleteOccurrence(db, 5);
  assert.strictEqual(snapshotsForDate(db, yesterday).length, 0, 'delete occurrence is not skipped history');
  assert.strictEqual(activeForDate(db, today).length, 1, 'delete occurrence preserves recurring chain');
}

{
  const db = { todos: [{ id: 6, title: 'daily', date_jalali: yesterday, scheduled_date: yesterday, repeat: 'daily', done: false, archived: false }] };
  editOnlyOccurrence(db, 6, { title: 'edited only yesterday', date_jalali: yesterday });
  assert.strictEqual(db.todos.filter(t => t._occurrence && t.title === 'edited only yesterday').length, 1, 'edit creates one standalone occurrence');
  assert.strictEqual(activeForDate(db, today).length, 1, 'editing one occurrence preserves today chain');
}

console.log('todo occurrence tests passed');
