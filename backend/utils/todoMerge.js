function todoRecency(item) {
  return Date.parse(item?.updated_at || item?.done_at || item?.completed_at || item?.completedAt || item?.created_at || '') || 0;
}

function scheduledKey(item) {
  const raw = String(item?.scheduled_date || item?.scheduledDate || item?.date_jalali || '');
  const parts = raw.split(/[^\d]+/).filter(Boolean);
  if (parts.length < 3) return 0;
  return Number(parts[0]) * 10000 + Number(parts[1]) * 100 + Number(parts[2]);
}

function isCompletionArtifact(todo) {
  return !!(todo && (todo._snapshot || todo._occurrence));
}

function isRecurringTemplate(todo) {
  return !!(todo && todo.repeat && todo.repeat !== 'none' && !isCompletionArtifact(todo));
}

function todoHasReopenAfter(openItem, doneAtMs) {
  const rows = Array.isArray(openItem?.history) ? openItem.history : [];
  return rows.some(row => {
    if (row?.action !== 'unchecked') return false;
    const at = Date.parse(row.created_at || '') || 0;
    return at >= doneAtMs;
  });
}

function mergeTodoHistory(a, b) {
  const rows = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  const seen = new Set();
  const out = [];
  rows.forEach(row => {
    const key = [row?.action, row?.created_at, row?.user_id, row?.new_value].map(value => String(value ?? '')).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  });
  return out;
}

function applyTodoDeltaMerge(incoming, previous, operation) {
  if (!incoming) return previous || incoming;
  if (!previous) return incoming;
  const op = String(operation || 'upsert');
  if (op === 'reopen') {
    return {
      ...previous,
      ...incoming,
      done: false,
      done_at: null,
      completedAt: null,
      completed_at: null,
      archived: incoming.archived === true ? incoming.archived : false,
      status: incoming.status || 'pending',
      history: mergeTodoHistory(previous.history, incoming.history),
    };
  }
  if (op === 'complete') {
    const incomingTime = Date.parse(incoming.updated_at || incoming.done_at || '') || 0;
    const previousTime = Date.parse(previous.updated_at || '') || 0;
    if (!previous.done && previousTime > incomingTime) return previous;
    if (todoHasReopenAfter(previous, incomingTime)) return previous;
  }
  return pickMergedTodo(incoming, previous);
}

function pickMergedTodo(incoming, previous) {
  if (!incoming) return previous || incoming;
  if (!previous) return incoming;
  if (isRecurringTemplate(incoming) && isRecurringTemplate(previous)) {
    const incomingKey = scheduledKey(incoming);
    const previousKey = scheduledKey(previous);
    if (incomingKey !== previousKey) return incomingKey > previousKey ? incoming : previous;
  }
  if (!!incoming.done !== !!previous.done) {
    const doneItem = incoming.done ? incoming : previous;
    const openItem = incoming.done ? previous : incoming;
    const doneAt = Date.parse(doneItem.done_at || doneItem.completed_at || doneItem.completedAt || doneItem.updated_at || '') || 0;
    // A newer updated_at on an open copy is often local maintenance, not an uncheck.
    if (todoHasReopenAfter(openItem, doneAt) || todoHasReopenAfter(doneItem, doneAt)) return openItem;
    return doneItem;
  }
  return todoRecency(incoming) >= todoRecency(previous) ? incoming : previous;
}

function deletedTodoIdSet(previousData, nextData) {
  const ids = new Set();
  const addAll = (list) => {
    (Array.isArray(list) ? list : []).forEach(id => {
      if (id != null && id !== '') ids.add(String(id));
    });
  };
  const addMap = (map) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    Object.keys(map).forEach(id => {
      if (id) ids.add(String(id));
    });
  };
  addAll(previousData?._todoTombstones);
  addAll(nextData?._todoTombstones);
  addAll(previousData?._deletedTodoIds);
  addAll(nextData?._deletedTodoIds);
  addMap(previousData?._deletedItems?.todos);
  addMap(nextData?._deletedItems?.todos);
  return ids;
}

function mergeOwnerTodosWithPrevious(previousData, nextData) {
  if (!nextData || typeof nextData !== 'object') return nextData;
  const previousTodos = Array.isArray(previousData?.todos) ? previousData.todos : [];
  const incomingTodos = Array.isArray(nextData.todos) ? nextData.todos : [];
  const incomingById = new Map();
  incomingTodos.forEach(todo => {
    if (!todo || todo.id == null) return;
    incomingById.set(String(todo.id), todo);
  });
  const explicitDeletes = deletedTodoIdSet(previousData, nextData);
  const merged = [];
  const seen = new Set();
  previousTodos.forEach(prev => {
    if (!prev || prev.id == null) return;
    const id = String(prev.id);
    if (explicitDeletes.has(id)) return;
    const incoming = incomingById.get(id);
    if (!incoming) {
      if (isCompletionArtifact(prev)) merged.push(prev);
      return;
    }
    seen.add(id);
    merged.push(pickMergedTodo(incoming, prev));
  });
  incomingTodos.forEach(todo => {
    if (!todo || todo.id == null) return;
    const id = String(todo.id);
    if (seen.has(id) || explicitDeletes.has(id)) return;
    merged.push(todo);
  });
  return { ...nextData, todos: merged };
}

module.exports = {
  todoRecency,
  scheduledKey,
  applyTodoDeltaMerge,
  pickMergedTodo,
  mergeOwnerTodosWithPrevious,
  isCompletionArtifact,
  deletedTodoIdSet,
};
