const COMPLETED_STATUSES = new Set(['completed', 'late_completed']);

const UPDATED_FIELD_READERS = {
  title: todo => todo?.title,
  note: todo => todo?.note,
  manager_note: todo => todo?.manager_note,
  priority: todo => todo?.priority,
  scheduled_date: todo => todo?.scheduled_date ?? todo?.scheduledDate ?? todo?.date_jalali ?? todo?.occurrence_date,
  time: todo => todo?.time,
  duration_min: todo => todo?.duration_min,
  repeat: todo => todo?.repeat,
  weekdays: todo => todo?.weekdays,
  remind_min: todo => todo?.remind_min,
  visibility: todo => todo?.visibility,
  shared_with: todo => todo?.shared_with ?? todo?.sharedWith,
  category: todo => todo?.category,
  goal_id: todo => todo?.goal_id,
  requires_report: todo => todo?.requires_report,
  requires_attachment: todo => todo?.requires_attachment,
  requires_approval: todo => todo?.requires_approval,
  staff_report: todo => todo?.staff_report,
  archived: todo => todo?.archived,
};

function stableValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(String).sort());
  if (value && typeof value === 'object') {
    const sorted = Object.keys(value).sort().reduce((out, key) => {
      out[key] = value[key];
      return out;
    }, {});
    return JSON.stringify(sorted);
  }
  return value == null ? null : String(value);
}

function todoId(todo) {
  return todo?.id == null ? '' : String(todo.id);
}

function isDone(todo) {
  if (typeof todo?.done === 'boolean') return todo.done;
  return COMPLETED_STATUSES.has(String(todo?.status || '').toLowerCase());
}

function todoStatus(todo) {
  const status = String(todo?.status || '').trim().toLowerCase();
  return status || (isDone(todo) ? 'completed' : 'pending');
}

function assigneeId(todo) {
  const value = todo?.assignee_id ?? todo?.assigneeId ?? todo?.staff_id ?? todo?.staffId;
  return value == null || value === '' ? null : String(value);
}

function recurringSnapshotIdentity(todo) {
  if (!todo?._snapshot || !todo?.archived || !isDone(todo)) return null;
  const snapshotId = todoId(todo);
  const rootTodoId = todo?.recurrence_parent_id ?? todo?.recurring_parent_id ?? todo?.parent_todo_id;
  if (!snapshotId || rootTodoId == null || rootTodoId === '') return null;
  const occurrence = todo?.occurrence_date ?? todo?.scheduled_date ?? todo?.scheduledDate ?? todo?.date_jalali ?? null;
  return {
    snapshotId,
    rootTodoId: String(rootTodoId),
    occurrence: occurrence == null || occurrence === '' ? null : String(occurrence),
  };
}

function changedUpdateFields(previous, next, { completionChanged, assigneeChanged }) {
  const fields = Object.entries(UPDATED_FIELD_READERS)
    .filter(([, read]) => stableValue(read(previous)) !== stableValue(read(next)))
    .map(([field]) => field);
  if (!completionChanged && todoStatus(previous) !== todoStatus(next)) fields.push('status');
  return [...new Set(fields)].filter(field => !(assigneeChanged && field === 'assignee_id'));
}

function diffTodos(previousTodos, nextTodos) {
  const previousById = new Map((Array.isArray(previousTodos) ? previousTodos : [])
    .filter(todo => todoId(todo))
    .map(todo => [todoId(todo), todo]));
  const nextById = new Map((Array.isArray(nextTodos) ? nextTodos : [])
    .filter(todo => todoId(todo))
    .map(todo => [todoId(todo), todo]));
  const changes = [];

  for (const [id, next] of nextById) {
    const previous = previousById.get(id);
    if (!previous) {
      // Recurrence snapshots represent completion history, not a user-created todo.
      if (next?._snapshot && next?.archived) {
        const identity = recurringSnapshotIdentity(next);
        if (identity) {
          changes.push({
            event: 'todo_completed',
            entityId: identity.snapshotId,
            targetUserId: assigneeId(next),
            metadata: { rootTodoId: identity.rootTodoId, occurrence: identity.occurrence },
            recurringSnapshot: true,
          });
        }
      } else {
        changes.push({ event: 'todo_created', entityId: id, targetUserId: assigneeId(next), metadata: {} });
      }
      continue;
    }

    const previousDone = isDone(previous);
    const nextDone = isDone(next);
    const completionChanged = previousDone !== nextDone;
    const previousAssignee = assigneeId(previous);
    const nextAssignee = assigneeId(next);
    const assigneeChanged = previousAssignee !== nextAssignee;

    if (completionChanged) {
      changes.push({
        event: nextDone ? 'todo_completed' : 'todo_reopened',
        entityId: id,
        targetUserId: nextAssignee,
        metadata: {
          previousDone,
          nextDone,
          previousStatus: todoStatus(previous),
          nextStatus: todoStatus(next),
        },
      });
    }
    if (assigneeChanged) {
      changes.push({
        event: 'todo_assigned',
        entityId: id,
        targetUserId: nextAssignee,
        metadata: { previousTargetUserId: previousAssignee, nextTargetUserId: nextAssignee },
      });
    }
    const changedFields = changedUpdateFields(previous, next, { completionChanged, assigneeChanged });
    if (changedFields.length) {
      changes.push({
        event: 'todo_updated', entityId: id, targetUserId: nextAssignee, metadata: { changedFields },
      });
    }
  }

  for (const [id, previous] of previousById) {
    if (!nextById.has(id)) {
      changes.push({ event: 'todo_deleted', entityId: id, targetUserId: assigneeId(previous), metadata: {} });
    }
  }
  return changes;
}

function emitTodoAudit(logger, req, changes) {
  for (const change of Array.isArray(changes) ? changes : []) {
    try {
      logger.audit(change.event, {
        requestId: req?.requestId,
        actorUserId: req?.user?.id || null,
        targetUserId: change.targetUserId,
        entityType: 'todo',
        entityId: change.entityId,
        metadata: change.metadata,
      });
    } catch (error) {
      try {
        logger.error('todo_audit_failed', {
          requestId: req?.requestId,
          userId: req?.user?.id,
          entityType: 'todo',
          entityId: change.entityId,
          errorCode: error?.code || error?.name || 'AUDIT_WRITE_FAILED',
        });
      } catch {}
    }
  }
}

module.exports = { diffTodos, emitTodoAudit, isDone, assigneeId, recurringSnapshotIdentity };
