const TOMBSTONE_COLLECTIONS = [
  'students',
  'packages',
  'payments',
  'sessions',
  'wallet_tx',
  'reminders',
  'topics',
  'key_events',
];

// These collections are served in pages of 200. A client that only loaded the
// first page still sends a shorter array; missing ids are not user deletions.
const PAGINATED_COLLECTIONS = [
  'students',
  'sessions',
  'payments',
  'packages',
  'families',
  'reminders',
  'expenses',
  'wallet_tx',
];

const MAX_TOMBSTONES_PER_COLLECTION = 4000;

function cloneTombstoneMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next = {};
  Object.entries(value).forEach(([id, deletedAt]) => {
    if (id == null || id === '') return;
    next[String(id)] = deletedAt || '';
  });
  return next;
}

function mergeDeletedItemMaps(previous, incoming) {
  const merged = {};
  const keys = new Set([
    ...Object.keys(previous && typeof previous === 'object' ? previous : {}),
    ...Object.keys(incoming && typeof incoming === 'object' ? incoming : {}),
  ]);
  keys.forEach(key => {
    const prevCol = previous?.[key] && typeof previous[key] === 'object' ? previous[key] : {};
    const nextCol = incoming?.[key] && typeof incoming[key] === 'object' ? incoming[key] : {};
    const col = cloneTombstoneMap(prevCol);
    Object.entries(cloneTombstoneMap(nextCol)).forEach(([id, deletedAt]) => {
      const prevAt = col[id] || '';
      if (!prevAt || String(deletedAt || '') >= String(prevAt)) col[id] = deletedAt || prevAt;
    });
    merged[key] = col;
  });
  return merged;
}

function collectionIds(data, key) {
  return (Array.isArray(data?.[key]) ? data[key] : [])
    .filter(item => item && item.id != null)
    .map(item => String(item.id));
}

function capTombstones(map) {
  const entries = Object.entries(map || {});
  if (entries.length <= MAX_TOMBSTONES_PER_COLLECTION) return map || {};
  entries.sort((a, b) => String(a[1] || '').localeCompare(String(b[1] || '')));
  return Object.fromEntries(entries.slice(entries.length - MAX_TOMBSTONES_PER_COLLECTION));
}

function filterCollectionByTombstones(items, tombstones) {
  if (!Array.isArray(items) || !tombstones || typeof tombstones !== 'object') return items;
  return items.filter(item => (
    !item || item.id == null || !Object.prototype.hasOwnProperty.call(tombstones, String(item.id))
  ));
}

function resurrectPresentIds(tombstones, nextData) {
  TOMBSTONE_COLLECTIONS.concat(PAGINATED_COLLECTIONS).forEach(key => {
    if (!Array.isArray(nextData?.[key]) || !tombstones[key]) return;
    collectionIds(nextData, key).forEach(id => {
      delete tombstones[key][id];
    });
  });
}

function retainUnsentPaginatedRows(previousData, nextData) {
  if (!nextData || typeof nextData !== 'object') return nextData;
  PAGINATED_COLLECTIONS.forEach(key => {
    if (!Array.isArray(nextData[key]) || !Array.isArray(previousData?.[key])) return;
    const tombstones = nextData._deletedItems?.[key] && typeof nextData._deletedItems[key] === 'object'
      ? nextData._deletedItems[key]
      : {};
    const nextIds = new Set(collectionIds(nextData, key));
    const extras = previousData[key].filter(item => {
      if (!item || item.id == null) return false;
      const id = String(item.id);
      if (nextIds.has(id)) return false;
      return !Object.prototype.hasOwnProperty.call(tombstones, id);
    });
    if (extras.length) nextData[key] = nextData[key].concat(extras);
  });
  return nextData;
}

function mergeAndApplyDeletedItems(previousData, nextData, {
  inferRemovals = true,
  resurrectPresent = false,
} = {}) {
  if (!nextData || typeof nextData !== 'object') return nextData;
  const tombstones = mergeDeletedItemMaps(previousData?._deletedItems, nextData._deletedItems);
  if (resurrectPresent) resurrectPresentIds(tombstones, nextData);
  if (inferRemovals) {
    const now = new Date().toISOString();
    TOMBSTONE_COLLECTIONS.forEach(key => {
      // Paginated business collections are often sent as a first page. Never
      // treat the unloaded remainder as a user delete.
      if (PAGINATED_COLLECTIONS.includes(key)) return;
      // A missing key means the client did not send this collection (partial
      // pagination / unloaded part), not that every row was deleted.
      if (!Array.isArray(nextData[key])) return;
      const previousIds = collectionIds(previousData, key);
      const nextIds = new Set(collectionIds(nextData, key));
      const missing = previousIds.filter(id => !nextIds.has(id));
      if (previousIds.length >= 10 && missing.length > Math.max(5, Math.ceil(previousIds.length * 0.1))) return;
      missing.forEach(id => {
        tombstones[key] = tombstones[key] || {};
        if (!tombstones[key][id]) tombstones[key][id] = now;
      });
    });
  }
  TOMBSTONE_COLLECTIONS.forEach(key => {
    const blocked = tombstones[key] || {};
    if (Array.isArray(nextData[key])) {
      nextData[key] = filterCollectionByTombstones(nextData[key], blocked);
    }
    if (blocked && Object.keys(blocked).length) tombstones[key] = capTombstones(blocked);
  });
  nextData._deletedItems = tombstones;
  return retainUnsentPaginatedRows(previousData, nextData);
}

const DESTRUCTIVE_COUNT_KEYS = [
  'students', 'packages', 'payments', 'sessions', 'expenses', 'families',
  'todos', 'staff', 'instructions', 'team_members', 'goals', 'habits',
  'reminders', 'wallet_tx',
];

function collectionLength(data, key) {
  return Array.isArray(data?.[key]) ? data[key].length : 0;
}

function looksLikeDestructiveCollectionOverwrite(previousData, nextData) {
  if (!previousData || !nextData) return false;
  return DESTRUCTIVE_COUNT_KEYS.some(key => {
    if (!Object.prototype.hasOwnProperty.call(nextData, key) || !Array.isArray(nextData[key])) return false;
    const prev = collectionLength(previousData, key);
    const next = collectionLength(nextData, key);
    if (prev >= 10 && next === 0) return true;
    return prev >= 20 && next < Math.ceil(prev * 0.5);
  });
}

function looksLikeDestructiveOverwrite(previousData, nextData) {
  const previousCount = DESTRUCTIVE_COUNT_KEYS.reduce((sum, key) => sum + collectionLength(previousData, key), 0);
  const nextCount = DESTRUCTIVE_COUNT_KEYS.reduce((sum, key) => sum + collectionLength(nextData, key), 0);
  if (previousCount < 3) return false;
  if (nextCount === 0) return true;
  return previousCount >= 10 && nextCount < Math.ceil(previousCount * 0.1);
}

function patchLooksDestructive(previousData, patch) {
  const collections = patch?.collections && typeof patch.collections === 'object' ? patch.collections : {};
  return Object.keys(collections).some(key => {
    const change = collections[key];
    const deletes = Array.isArray(change?.delete) ? change.delete.length : 0;
    const prev = collectionLength(previousData, key);
    if (prev >= 10 && deletes >= prev && !(Array.isArray(change?.upsert) && change.upsert.length)) return true;
    return prev >= 20 && deletes > Math.ceil(prev * 0.5);
  });
}

module.exports = {
  TOMBSTONE_COLLECTIONS,
  PAGINATED_COLLECTIONS,
  MAX_TOMBSTONES_PER_COLLECTION,
  mergeAndApplyDeletedItems,
  retainUnsentPaginatedRows,
  filterCollectionByTombstones,
  looksLikeDestructiveOverwrite,
  looksLikeDestructiveCollectionOverwrite,
  patchLooksDestructive,
};
