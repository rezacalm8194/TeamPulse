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

function mergeAndApplyDeletedItems(previousData, nextData, { inferRemovals = true } = {}) {
  if (!nextData || typeof nextData !== 'object') return nextData;
  const tombstones = mergeDeletedItemMaps(previousData?._deletedItems, nextData._deletedItems);
  if (inferRemovals) {
    const now = new Date().toISOString();
    TOMBSTONE_COLLECTIONS.forEach(key => {
      const nextIds = new Set(collectionIds(nextData, key));
      collectionIds(previousData, key).forEach(id => {
        if (nextIds.has(id)) return;
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
  return nextData;
}

module.exports = {
  TOMBSTONE_COLLECTIONS,
  MAX_TOMBSTONES_PER_COLLECTION,
  mergeAndApplyDeletedItems,
  filterCollectionByTombstones,
};
