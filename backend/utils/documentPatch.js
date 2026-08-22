const SERVER_OWNED_KEYS = new Set([
  '_gdrive_token',
  '_gdrive_token_expiry',
  '_gcal_token',
  '_gcal_token_expiry',
  '_todoTombstones',
  '_workspaceId',
  '_deletedTodoIds',
]);

const MAX_PATCH_COLLECTIONS = 80;
const MAX_PATCH_ITEMS_PER_COLLECTION = 20000;

function isIdCollection(value) {
  if (!Array.isArray(value) || !value.length) return Array.isArray(value);
  return value.every(item => item == null || (typeof item === 'object' && item.id != null));
}

function isAllowedScalarKey(key) {
  return typeof key === 'string' && key.length && !SERVER_OWNED_KEYS.has(key);
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(id => String(id)).filter(Boolean))];
}

function applyCollectionChange(previousItems, change = {}) {
  const deleted = new Set(normalizeIdList(change.delete));
  const upserts = Array.isArray(change.upsert) ? change.upsert : [];
  if (deleted.size > MAX_PATCH_ITEMS_PER_COLLECTION || upserts.length > MAX_PATCH_ITEMS_PER_COLLECTION) {
    const error = new Error('patch_too_large');
    error.code = 'patch_too_large';
    throw error;
  }
  const next = (Array.isArray(previousItems) ? previousItems : []).filter(item => {
    if (item == null || item.id == null) return !deleted.size;
    return !deleted.has(String(item.id));
  });
  upserts.forEach(item => {
    if (!item || typeof item !== 'object' || item.id == null) return;
    const id = String(item.id);
    const index = next.findIndex(row => String(row?.id) === id);
    if (index >= 0) next[index] = item;
    else next.push(item);
  });
  return next;
}

function applyDocumentPatch(previousData, patch = {}) {
  const previous = previousData && typeof previousData === 'object' ? previousData : {};
  const next = { ...previous };
  const collections = patch.collections && typeof patch.collections === 'object' ? patch.collections : {};
  const keys = Object.keys(collections);
  if (keys.length > MAX_PATCH_COLLECTIONS) {
    const error = new Error('patch_too_large');
    error.code = 'patch_too_large';
    throw error;
  }
  keys.forEach(key => {
    if (!isAllowedScalarKey(key)) return;
    const change = collections[key];
    if (!change || typeof change !== 'object') return;
    const current = next[key];
    if (current != null && !Array.isArray(current) && current !== undefined) return;
    next[key] = applyCollectionChange(Array.isArray(current) ? current : [], change);
  });
  const scalars = patch.scalars && typeof patch.scalars === 'object' ? patch.scalars : {};
  Object.keys(scalars).forEach(key => {
    if (!isAllowedScalarKey(key) || Object.prototype.hasOwnProperty.call(collections, key)) return;
    next[key] = scalars[key];
  });
  return next;
}

function candidateTodosFromPatch(previousData, patch = {}) {
  const previousTodos = Array.isArray(previousData?.todos) ? previousData.todos : [];
  const change = patch.collections?.todos;
  if (!change) return previousTodos;
  return applyCollectionChange(previousTodos, change);
}

module.exports = {
  SERVER_OWNED_KEYS,
  applyDocumentPatch,
  candidateTodosFromPatch,
  isIdCollection,
  isAllowedScalarKey,
  normalizeIdList,
};
