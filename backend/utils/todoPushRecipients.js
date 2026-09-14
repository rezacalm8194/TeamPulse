const { ownStaffIdsForGrant, todoAssignedToMember } = require('./teamTodoMerge');

function todoHasStaffAssignee(todo) {
  const ids = [todo?.assignee_id, todo?.assigneeId, todo?.staff_id, todo?.staffId]
    .filter(value => value != null && String(value).trim() !== '');
  const emails = [todo?.assignee_email, todo?.assigneeEmail]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return ids.length > 0 || emails.length > 0;
}

function todoShouldNotifyOwner(todo) {
  return !todoHasStaffAssignee(todo);
}

function teamMemberCanReceiveTodoPush(permissions) {
  const list = Array.isArray(permissions) ? permissions : [];
  return list.includes('todolist')
    || list.includes('todo_view_assigned')
    || list.includes('todo_view_team')
    || list.includes('todo_manage_staff');
}

function todoShouldNotifyTeamMember(todo, data, grant) {
  if (!grant || !teamMemberCanReceiveTodoPush(grant.permissions)) return false;
  const email = String(grant.email || grant.memberEmail || '').trim().toLowerCase();
  const ownStaffIds = ownStaffIdsForGrant(data, grant);
  return todoAssignedToMember(todo, email, ownStaffIds);
}

module.exports = {
  todoHasStaffAssignee,
  todoShouldNotifyOwner,
  teamMemberCanReceiveTodoPush,
  todoShouldNotifyTeamMember,
};
