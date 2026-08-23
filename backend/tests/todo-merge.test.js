const test = require('node:test');
const assert = require('node:assert/strict');
const { pickMergedTodo, mergeOwnerTodosWithPrevious } = require('../utils/todoMerge');

test('keeps completed todo over a stale open copy', () => {
  const incoming = { id: 1, done: false, updated_at: '2026-08-23T08:00:00.000Z', date_jalali: '1405/06/01' };
  const previous = { id: 1, done: true, done_at: '2026-08-23T09:00:00.000Z', updated_at: '2026-08-23T09:00:00.000Z', date_jalali: '1405/06/01' };
  const merged = pickMergedTodo(incoming, previous);
  assert.equal(merged.done, true);
});

test('keeps a laptop completion over a newer open copy without uncheck history', () => {
  const incoming = { id: 1, done: false, updated_at: '2026-08-23T10:05:00.000Z', date_jalali: '1405/06/01' };
  const previous = { id: 1, done: true, done_at: '2026-08-23T10:00:00.000Z', updated_at: '2026-08-23T10:00:00.000Z', date_jalali: '1405/06/01' };
  const merged = pickMergedTodo(incoming, previous);
  assert.equal(merged.done, true);
});

test('keeps an explicit uncheck that happened after the completion', () => {
  const incoming = {
    id: 1,
    done: false,
    updated_at: '2026-08-23T10:05:00.000Z',
    history: [{ action: 'unchecked', created_at: '2026-08-23T10:05:00.000Z' }],
  };
  const previous = { id: 1, done: true, done_at: '2026-08-23T10:00:00.000Z', updated_at: '2026-08-23T10:00:00.000Z' };
  const merged = pickMergedTodo(incoming, previous);
  assert.equal(merged.done, false);
});

test('keeps later recurring date so an overdue tick is not rolled back', () => {
  const incoming = { id: 2, repeat: 'daily', done: false, date_jalali: '1403/05/31', updated_at: '2026-08-23T10:00:00.000Z' };
  const previous = { id: 2, repeat: 'daily', done: false, date_jalali: '1405/06/01', scheduled_date: '1405/06/01', updated_at: '2026-08-22T18:00:00.000Z' };
  const merged = pickMergedTodo(incoming, previous);
  assert.equal(merged.date_jalali, '1405/06/01');
});

test('owner save keeps completion snapshots omitted by a stale desktop document', () => {
  const previous = {
    todos: [
      { id: 2, repeat: 'daily', date_jalali: '1405/06/01', done: false },
      { id: 99, _snapshot: true, done: true, recurrence_parent_id: 2, date_jalali: '1403/05/31' },
    ],
  };
  const next = mergeOwnerTodosWithPrevious(previous, {
    todos: [{ id: 2, repeat: 'daily', date_jalali: '1403/05/31', done: false, updated_at: '2026-08-23T10:00:00.000Z' }],
  });
  assert.equal(next.todos.length, 2);
  assert.ok(next.todos.some(t => t.id === 99 && t._snapshot));
  assert.equal(next.todos.find(t => t.id === 2).date_jalali, '1405/06/01');
});
