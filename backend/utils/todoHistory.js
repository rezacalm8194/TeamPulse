'use strict';

// Todo history: full on the server, recent-only on the wire.
//
// Every completion of a recurring todo appends a row to todo.history and rows
// are never removed (the client only ever pushes). One account had 14,055
// rows = 2.2 MB of a 3.1 MB startup document, re-downloaded and parsed on
// every app open, while the client only reads recent rows ("closed today?",
// "reopened after done?").
//
// So:
//   * Storage keeps the complete history. Every write (upsertTodos /
//     replaceTodos) unions the incoming rows with the stored rows, so a client
//     that only holds the recent part can never shrink the stored log.
//   * Responses carry only the last TODO_HISTORY_SEND_DAYS days of history
//     (plus at least the newest TODO_HISTORY_MIN_ROWS rows).

const TODO_HISTORY_SEND_DAYS = 60;
const TODO_HISTORY_MIN_ROWS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// Same identity the existing mergeTodoHistory (todoMerge.js) uses.
function historyRowKey(row) {
  return [row?.action, row?.created_at, row?.user_id, row?.new_value]
    .map(value => String(value ?? '')).join('|');
}

// Stored rows first (original order), then any incoming rows not seen yet.
function mergeHistoryRows(stored, incoming) {
  const out = [];
  const seen = new Set();
  for (const row of [...(Array.isArray(stored) ? stored : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (row == null) continue;
    const key = historyRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

// Returns the todo to store: incoming fields, history = stored ∪ incoming.
function withPreservedHistory(incomingTodo, storedTodo) {
  if (!incomingTodo || typeof incomingTodo !== 'object') return incomingTodo;
  const storedHistory = Array.isArray(storedTodo?.history) ? storedTodo.history : [];
  if (!storedHistory.length) return incomingTodo;
  const merged = mergeHistoryRows(storedHistory, incomingTodo.history);
  const incomingLength = Array.isArray(incomingTodo.history) ? incomingTodo.history.length : 0;
  if (merged.length === incomingLength) return incomingTodo;
  return { ...incomingTodo, history: merged };
}

function trimTodoHistoryForClient(todo, now = Date.now()) {
  if (!todo || typeof todo !== 'object' || !Array.isArray(todo.history)) return todo;
  const history = todo.history;
  if (history.length <= TODO_HISTORY_MIN_ROWS) return todo;
  const cutoff = now - TODO_HISTORY_SEND_DAYS * DAY_MS;
  const keepFrom = history.length - TODO_HISTORY_MIN_ROWS;
  const kept = history.filter((row, index) => {
    if (index >= keepFrom) return true;
    const at = Date.parse(row?.created_at || '');
    return !Number.isFinite(at) || at >= cutoff; // undated rows: keep
  });
  if (kept.length === history.length) return todo;
  return { ...todo, history: kept };
}

function trimTodosForClient(todos, now = Date.now()) {
  return Array.isArray(todos) ? todos.map(todo => trimTodoHistoryForClient(todo, now)) : todos;
}

// For a document payload ({ todos: [...] , ... }); returns a shallow copy.
function trimDocumentTodosForClient(data, now = Date.now()) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.todos)) return data;
  return { ...data, todos: trimTodosForClient(data.todos, now) };
}

module.exports = {
  TODO_HISTORY_SEND_DAYS,
  TODO_HISTORY_MIN_ROWS,
  historyRowKey,
  mergeHistoryRows,
  withPreservedHistory,
  trimTodoHistoryForClient,
  trimTodosForClient,
  trimDocumentTodosForClient,
};
