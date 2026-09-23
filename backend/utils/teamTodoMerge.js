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
  const grantStaffId = String(grant?.staffId || grant?.staff_id || grant?.claimedStaffId || '').trim();
  if (grantStaffId) ids.add(grantStaffId);
  ownStaffRowsForGrant(data, grant).forEach(staff => {
    if (staff?.id != null) ids.add(String(staff.id));
  });
  const memberEmail = String(grant?.email || '').trim().toLowerCase();
  (Array.isArray(data?.team_members) ? data.team_members : []).forEach(member => {
    if (!memberEmail || String(member?.email || '').trim().toLowerCase() !== memberEmail) return;
    if (member?.status === 'حذف‌شده') return;
    const staffId = String(member?.staff_id || member?.staffId || '').trim();
    if (staffId) ids.add(staffId);
  });
  return ids;
}

function attachClaimedStaffId(grant, data, claimedStaffId) {
  if (!grant) return grant;
  const claimed = String(claimedStaffId || '').trim();
  if (!claimed) return grant;
  const known = ownStaffIdsForGrant(data, grant);
  if (known.has(claimed)) return { ...grant, staffId: grant.staffId || claimed, claimedStaffId: claimed };
  const memberEmail = String(grant.email || '').trim().toLowerCase();
  const staff = (Array.isArray(data?.staff) ? data.staff : []).find(row => String(row?.id) === claimed);
  const member = (Array.isArray(data?.team_members) ? data.team_members : []).find(row =>
    memberEmail && String(row?.email || '').trim().toLowerCase() === memberEmail && row?.status !== 'حذف‌شده'
  );
  const memberStaffId = String(member?.staff_id || member?.staffId || '').trim();
  const emailMatchesStaff = !!(staff && memberEmail && staffEmail(staff) === memberEmail);
  if (emailMatchesStaff || memberStaffId === claimed || (member && !memberStaffId && staff)) {
    return { ...grant, staffId: claimed, claimedStaffId: claimed };
  }
  return grant;
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

function mergeTodoTombstones(previousData, _nextTodoIds, removedTodoIds) {
  const tombstones = existingTodoTombstones(previousData);
  (removedTodoIds || []).forEach(id => tombstones.add(String(id)));
  // Do not clear tombstones just because a stale payload reintroduces an id;
  // owner/team merge already refuses to resurrect tombstoned todos.
  const list = [...tombstones];
  return list.length > MAX_TODO_TOMBSTONES ? list.slice(list.length - MAX_TODO_TOMBSTONES) : list;
}

function isCompletionSnapshot(todo) {
  return !!(todo && todo.archived && todo.done && (todo._snapshot || todo._occurrence));
}

const TEAM_STUDENT_WRITE_PERMISSIONS = ['archive', 'customerlist', 'students', 'sessions'];
const TEAM_STUDENT_RELATED_COLLECTIONS = [
  'packages',
  'payments',
  'sessions',
  'wallet_tx',
  'reminders',
  'topics',
  'key_events',
];
const ARCHIVE_SCALAR_KEYS = [
  'archive_columns',
  'archive_categories',
  'archive_relationship_statuses',
];

function canWriteTeamStudents(permissions) {
  const list = Array.isArray(permissions) ? permissions : [];
  return TEAM_STUDENT_WRITE_PERMISSIONS.some(key => list.includes(key));
}

function mergeTeamIdCollection(previousItems, incomingItems, deletedIds) {
  const deleted = new Set((deletedIds || []).map(id => String(id)).filter(Boolean));
  const incoming = Array.isArray(incomingItems) ? incomingItems : [];
  const incomingById = new Map();
  incoming.forEach(item => {
    if (!item || item.id == null) return;
    incomingById.set(String(item.id), item);
  });
  const next = [];
  const seen = new Set();
  (Array.isArray(previousItems) ? previousItems : []).forEach(item => {
    if (!item || item.id == null) return;
    const id = String(item.id);
    if (deleted.has(id)) return;
    seen.add(id);
    next.push(incomingById.has(id) ? incomingById.get(id) : item);
  });
  incoming.forEach(item => {
    if (!item || item.id == null) return;
    const id = String(item.id);
    if (deleted.has(id) || seen.has(id)) return;
    seen.add(id);
    next.push(item);
  });
  return next;
}

function deletedIdsFromTombstones(tombstones, key) {
  const map = tombstones && typeof tombstones === 'object' && !Array.isArray(tombstones)
    ? tombstones[key]
    : null;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.keys(map);
}

function allowedTeamDocumentPatch(patch, grant) {
  const collections = {};
  const scalars = {};
  const srcCollections = patch?.collections && typeof patch.collections === 'object' ? patch.collections : {};
  const srcScalars = patch?.scalars && typeof patch.scalars === 'object' ? patch.scalars : {};
  const permissions = grant?.permissions || [];
  if (Object.prototype.hasOwnProperty.call(srcScalars, '_lastSaved')) {
    scalars._lastSaved = srcScalars._lastSaved;
  }
  if (canWriteTeamStudents(permissions)) {
    if (srcCollections.students) collections.students = srcCollections.students;
    TEAM_STUDENT_RELATED_COLLECTIONS.forEach(key => {
      if (srcCollections[key]) collections[key] = srcCollections[key];
    });
    if (Object.prototype.hasOwnProperty.call(srcScalars, '_deletedItems')) {
      scalars._deletedItems = srcScalars._deletedItems;
    }
    ARCHIVE_SCALAR_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(srcScalars, key)) scalars[key] = srcScalars[key];
    });
  }
  return { collections, scalars };
}

function teamTodoWriteApplied(oldTodo, savedTodo, incoming, operation) {
  if (!incoming) return true;
  if (!savedTodo) return false;
  const op = String(operation || 'upsert');
  if (op === 'complete') {
    if (incoming.done) return !!savedTodo.done;
    const incomingKey = scheduledKey(incoming);
    const savedKey = scheduledKey(savedTodo);
    const oldKey = scheduledKey(oldTodo);
    if (incomingKey && savedKey >= incomingKey && incomingKey >= oldKey) return true;
    return !!savedTodo.done && !oldTodo?.done;
  }
  if (op === 'reopen') return !savedTodo.done;
  return JSON.stringify(savedTodo) !== JSON.stringify(oldTodo);
}

function mergeAllowedTeamTodos(previousData, nextData, grant, operation = 'upsert') {
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
  const addDeletedMap = (map) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    Object.keys(map).forEach(id => { if (id) deletedTodoIds.add(String(id)); });
  };
  addDeletedMap(previousData._deletedItems?.todos);
  addDeletedMap(nextData._deletedItems?.todos);
  existingTodoTombstones(previousData).forEach(id => deletedTodoIds.add(id));
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
    const op = String(operation || 'upsert');
    const dateAdvanced = scheduledKey(incoming) > scheduledKey(oldTodo);
    const wantsComplete = !!incoming.done !== !!oldTodo.done || dateAdvanced ||
      String(incoming.status || '') !== String(oldTodo.status || '');
    if (!canCompleteOwn && wantsComplete) {
      if (!canReportOwn) return oldTodo;
      return {
        ...oldTodo,
        staff_report: incoming.staff_report || oldTodo.staff_report || '',
        report_updated_at: incoming.report_updated_at || oldTodo.report_updated_at || null,
      };
    }
    const nextDone = canCompleteOwn ? !!incoming.done : !!oldTodo.done;
    const nextDoneAt = canCompleteOwn
      ? (nextDone ? (incoming.done_at || incoming.completedAt || incoming.completed_at || oldTodo.done_at || new Date().toISOString()) : null)
      : oldTodo.done_at;
    const nextStatus = canCompleteOwn
      ? (nextDone ? (incoming.status || oldTodo.status || 'completed') : (incoming.status || 'pending'))
      : oldTodo.status;
    const completedRecurringOccurrence = canCompleteOwn && !incoming.done && (
      completedRoots.has(String(todoRootId(oldTodo))) ||
      ((op === 'complete' || (oldTodo.repeat && oldTodo.repeat !== 'none')) && dateAdvanced)
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
      history: canCompleteOwn || canReportOwn ? (incoming.history || oldTodo.history) : oldTodo.history,
      updated_at: canCompleteOwn || canReportOwn ? (incoming.updated_at || oldTodo.updated_at) : oldTodo.updated_at,
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
    _todoTombstones: mergeTodoTombstones(
      previousData,
      nextTodos.map(t => t.id),
      previousTodos
        .map(todo => String(todo?.id))
        .filter(id => id && !nextTodos.some(todo => String(todo?.id) === id))
    ),
    _lastSaved: nextData._lastSaved || previousData._lastSaved,
  };
}

function mergeAllowedTeamDocument(previousData, nextData, grant) {
  const merged = mergeAllowedTeamTodos(previousData, nextData, grant);
  if (!grant || !previousData || !nextData || !canWriteTeamStudents(grant.permissions)) return merged;
  const tombstones = nextData._deletedItems;
  merged.students = mergeTeamIdCollection(
    previousData.students,
    nextData.students,
    deletedIdsFromTombstones(tombstones, 'students')
  );
  TEAM_STUDENT_RELATED_COLLECTIONS.forEach(key => {
    if (!Array.isArray(nextData[key]) && !deletedIdsFromTombstones(tombstones, key).length) return;
    merged[key] = mergeTeamIdCollection(
      previousData[key],
      nextData[key],
      deletedIdsFromTombstones(tombstones, key)
    );
  });
  ARCHIVE_SCALAR_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(nextData, key)) merged[key] = nextData[key];
  });
  if (tombstones && typeof tombstones === 'object') merged._deletedItems = tombstones;
  merged._lastSaved = nextData._lastSaved || previousData._lastSaved;
  return merged;
}

module.exports = {
  staffEmail,
  ownStaffRowsForGrant,
  ownStaffIdsForGrant,
  attachClaimedStaffId,
  todoAssignedToMember,
  todoRootId,
  todoSharedWith,
  todoVisibleToTeamMember,
  existingTodoTombstones,
  mergeTodoTombstones,
  mergeAllowedTeamTodos,
  mergeAllowedTeamDocument,
  allowedTeamDocumentPatch,
  canWriteTeamStudents,
  TEAM_STUDENT_RELATED_COLLECTIONS,
  isCompletionSnapshot,
  teamTodoWriteApplied,
};
