const { scheduledKey } = require('./todoMerge');

const MAX_TODO_TOMBSTONES = 4000;

function todoSharedWith(todo) {
  if (Array.isArray(todo?.shared_with)) return todo.shared_with.map(String);
  if (Array.isArray(todo?.sharedWith)) return todo.sharedWith.map(String);
  return [];
}

function staffEmail(staff) {
  return String(staff?.email || staff?.work_email || staff?.username || '').trim().toLowerCase();
}

function ownStaffRowsForGrant(data, grant) {
  const rows = Array.isArray(data?.staff) ? data.staff : [];
  const staffId = String(grant?.staffId || grant?.staff_id || '').trim();
  const memberEmail = String(grant?.email || '').trim().toLowerCase();
  return rows.filter(staff => {
    const sameId = staffId && String(staff?.id || '') === staffId;
    const sameEmail = memberEmail && staffEmail(staff) === memberEmail;
    return sameId || sameEmail;
  });
}

function ownStaffIdsForGrant(data, grant) {
  const ids = new Set();
  const grantStaffId = String(grant?.staffId || grant?.staff_id || '').trim();
  if (grantStaffId) ids.add(grantStaffId);
  ownStaffRowsForGrant(data, grant).forEach(staff => {
    if (staff?.id != null) ids.add(String(staff.id));
  });
  return ids;
}

function todoAssignedToMember(todo, memberEmail, ownStaffIds = new Set()) {
  const emails = [todo?.assignee_email, todo?.assigneeEmail]
    .filter(Boolean)
    .map(v => String(v).trim().toLowerCase());
  if (memberEmail && emails.includes(memberEmail)) return true;
  const ids = [todo?.assignee_id, todo?.assigneeId, todo?.staff_id, todo?.staffId]
    .filter(v => v != null)
    .map(v => String(v));
  return ids.some(id => ownStaffIds.has(id));
}

function todoRootId(todo) {
  return todo?.recurrence_parent_id ||
    todo?.recurring_parent_id ||
    todo?.parent_todo_id ||
    todo?.template_id ||
    todo?.id;
}

function todoVisibleToTeamMember(todo, memberEmail, permissions, ownStaffIds = new Set()) {
  const visibility = todo?.visibility || (todo?.assignee_id ? 'assignee' : 'private');
  if (permissions.includes('todo_view_team') || permissions.includes('todo_manage_staff')) return true;
  if (permissions.includes('todo_view_assigned') && todoAssignedToMember(todo, memberEmail, ownStaffIds)) return true;
  if (permissions.includes('todo_view_shared') && todoSharedWith(todo).map(x => x.toLowerCase()).includes(memberEmail)) return true;
  if (permissions.includes('todo_view_clients') && String(todo?.category || '') === 'clients') return true;
  if (visibility === 'team' && permissions.includes('todo_view_shared')) return true;
  return false;
}

function existingTodoTombstones(data) {
  return new Set(
    (Array.isArray(data?._todoTombstones) ? data._todoTombstones : [])
      .map(id => String(id))
      .filter(Boolean)
  );
}

function mergeTodoTombstones(previousData, nextTodoIds, removedTodoIds) {
  const tombstones = existingTodoTombstones(previousData);
  (removedTodoIds || []).forEach(id => tombstones.add(String(id)));
  (nextTodoIds || []).forEach(id => tombstones.delete(String(id)));
  const list = [...tombstones];
  return list.length > MAX_TODO_TOMBSTONES ? list.slice(list.length - MAX_TODO_TOMBSTONES) : list;
}

function isCompletionSnapshot(todo) {
  return !!(todo && todo.archived && todo.done && (todo._snapshot || todo._occurrence));
}

function historyHasCompletedAfter(todo, afterMs) {
  const rows = Array.isArray(todo?.history) ? todo.history : [];
  return rows.some(row => {
    if (row?.action !== 'completed') return false;
    const at = Date.parse(row.created_at || '') || 0;
    return at >= afterMs;
  });
}

function mergeAllowedTeamTodos(previousData, nextData, grant) {
  if (!grant || !previousData || !nextData) return nextData;
  const memberEmail = grant.email;
  const permissions = grant.permissions || [];
  const previousTodos = Array.isArray(previousData.todos) ? previousData.todos : [];
  const incomingTodos = Array.isArray(nextData.todos) ? nextData.todos : [];
  const ownStaffIds = ownStaffIdsForGrant(previousData, grant);
  const incomingById = new Map(incomingTodos.map(t => [String(t.id), t]));
  const tombstones = existingTodoTombstones(previousData);
  const deletedTodoIds = new Set(
    (Array.isArray(nextData._deletedTodoIds) ? nextData._deletedTodoIds : [])
      .map(id => String(id))
      .filter(Boolean)
  );
  const canDeleteTodos = permissions.includes('todo_delete') ||
    permissions.includes('todo_manage_staff') ||
    permissions.includes('todo_edit_manager');
  const canCompleteAssigned = permissions.includes('todo_complete_own') ||
    permissions.includes('todo_edit_manager') ||
    permissions.includes('todo_manage_staff');
  const validCompletionSnapshots = incomingTodos.filter(todo => {
    if (!canCompleteAssigned || !isCompletionSnapshot(todo)) return false;
    if (!todoAssignedToMember(todo, memberEmail, ownStaffIds)) return false;
    const root = String(todoRootId(todo));
    return previousTodos.some(oldTodo =>
      String(todoRootId(oldTodo)) === root &&
      todoAssignedToMember(oldTodo, memberEmail, ownStaffIds) &&
      todoVisibleToTeamMember(oldTodo, memberEmail, permissions, ownStaffIds)
    );
  });
  const completedRoots = new Set(validCompletionSnapshots.map(todo => String(todoRootId(todo))));
  const nextTodos = previousTodos.map(oldTodo => {
    const requestedDelete = deletedTodoIds.has(String(oldTodo.id)) || deletedTodoIds.has(String(todoRootId(oldTodo)));
    const canDeleteThisTodo = canDeleteTodos ||
      (permissions.includes('todo_create_self') && todoAssignedToMember(oldTodo, memberEmail, ownStaffIds));
    if (
      requestedDelete &&
      canDeleteThisTodo &&
      todoVisibleToTeamMember(oldTodo, memberEmail, permissions, ownStaffIds)
    ) {
      return null;
    }
    const incoming = incomingById.get(String(oldTodo.id));
    if (!incoming) return oldTodo;
    if (!todoVisibleToTeamMember(oldTodo, memberEmail, permissions, ownStaffIds)) return oldTodo;
    const assignedToMember = todoAssignedToMember(oldTodo, memberEmail, ownStaffIds) || todoAssignedToMember(incoming, memberEmail, ownStaffIds);
    const canCompleteOwn = assignedToMember && (
      permissions.includes('todo_complete_own') ||
      permissions.includes('todo_edit_manager') ||
      permissions.includes('todo_manage_staff')
    );
    const canReportOwn = assignedToMember && (
      permissions.includes('todo_report_own') ||
      permissions.includes('todo_edit_manager') ||
      permissions.includes('todo_manage_staff')
    );
    const canEditManager = permissions.includes('todo_edit_manager');
    if (canEditManager) return { ...oldTodo, ...incoming };
    const nextDone = canCompleteOwn ? !!incoming.done : !!oldTodo.done;
    const nextDoneAt = canCompleteOwn
      ? (nextDone ? (incoming.done_at || incoming.completedAt || incoming.completed_at || oldTodo.done_at || new Date().toISOString()) : null)
      : oldTodo.done_at;
    const nextStatus = canCompleteOwn
      ? (nextDone ? (incoming.status || oldTodo.status || 'completed') : (incoming.status || 'pending'))
      : oldTodo.status;
    const oldUpdatedMs = Date.parse(oldTodo.updated_at || oldTodo.done_at || '') || 0;
    const completedRecurringOccurrence = canCompleteOwn &&
      oldTodo.repeat && oldTodo.repeat !== 'none' &&
      !incoming.done &&
      (
        completedRoots.has(String(todoRootId(oldTodo))) ||
        (scheduledKey(incoming) > scheduledKey(oldTodo) && historyHasCompletedAfter(incoming, oldUpdatedMs))
      );
    return {
      ...oldTodo,
      done: nextDone,
      done_at: nextDoneAt,
      completedAt: canCompleteOwn ? nextDoneAt : oldTodo.completedAt,
      completed_at: canCompleteOwn ? nextDoneAt : oldTodo.completed_at,
      completed_by: canCompleteOwn ? (incoming.completed_by || memberEmail) : oldTodo.completed_by,
      completed_by_email: canCompleteOwn ? (incoming.completed_by_email || memberEmail) : oldTodo.completed_by_email,
      status: nextStatus,
      staff_report: canReportOwn ? (incoming.staff_report || oldTodo.staff_report || '') : oldTodo.staff_report,
      report_updated_at: canReportOwn ? (incoming.report_updated_at || oldTodo.report_updated_at || null) : oldTodo.report_updated_at,
      history: incoming.history || oldTodo.history,
      updated_at: incoming.updated_at || oldTodo.updated_at,
      ...(completedRecurringOccurrence ? {
        date_jalali: incoming.date_jalali || oldTodo.date_jalali,
        scheduled_date: incoming.scheduled_date || incoming.scheduledDate || oldTodo.scheduled_date,
        scheduledDate: incoming.scheduledDate || incoming.scheduled_date || oldTodo.scheduledDate,
        occurrence_date: incoming.occurrence_date || incoming.scheduled_date || incoming.date_jalali || oldTodo.occurrence_date,
        recurrence_parent_id: incoming.recurrence_parent_id || todoRootId(oldTodo),
        archived: false,
      } : {}),
    };
  }).filter(Boolean);
  if (permissions.includes('todo_create_self') || validCompletionSnapshots.length) {
    const completionSnapshotIds = new Set(validCompletionSnapshots.map(todo => String(todo.id)));
    incomingTodos.forEach(todo => {
      if (previousTodos.some(x => String(x.id) === String(todo.id))) return;
      if (tombstones.has(String(todo.id))) return;
      if (!todoAssignedToMember(todo, memberEmail, ownStaffIds)) return;
      if (!permissions.includes('todo_create_self') && !completionSnapshotIds.has(String(todo.id))) return;
      nextTodos.push(todo);
    });
  }
  return {
    ...previousData,
    todos: nextTodos,
    _todoTombstones: mergeTodoTombstones(previousData, nextTodos.map(t => t.id), []),
    _lastSaved: nextData._lastSaved || previousData._lastSaved,
  };
}

module.exports = {
  staffEmail,
  ownStaffRowsForGrant,
  ownStaffIdsForGrant,
  todoAssignedToMember,
  todoRootId,
  todoSharedWith,
  todoVisibleToTeamMember,
  existingTodoTombstones,
  mergeTodoTombstones,
  mergeAllowedTeamTodos,
  isCompletionSnapshot,
};
