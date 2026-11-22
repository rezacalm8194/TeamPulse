'use strict';

// Device clock correction for synced rows.
//
// Conflicts between devices are resolved by each row's timestamp
// (updated_at, else created_at / logged_at): the newer one wins. Those
// timestamps come from the device clock. A phone whose clock is an hour
// behind therefore loses every conflict for an hour: its edits are silently
// ignored. A clock that is ahead is worse, because its rows block real edits
// from other devices until real time catches up.
//
// The client sends its current time (client_now) with each sync. If it differs
// from the server clock by more than MIN_SKEW_MS, the timestamps of the rows in
// that request are shifted onto the server clock before they are compared and
// stored, so every stored timestamp lives on the same clock.

const MIN_SKEW_MS = 60 * 1000;            // ignore network delay and small drift
const MAX_SKEW_MS = 30 * 24 * 60 * 60 * 1000; // a bogus value, not a clock offset

function clientClockSkewMs(clientNow, serverNow = Date.now()) {
  const client = Number(clientNow);
  if (!Number.isFinite(client) || client <= 0) return 0;
  const skew = serverNow - client;
  if (Math.abs(skew) < MIN_SKEW_MS || Math.abs(skew) > MAX_SKEW_MS) return 0;
  return skew;
}

// Shift only the field the conflict check reads (same order as rowTimestamp
// in documentPatch.js / businessStore.js).
function correctRowClock(row, skewMs) {
  if (!skewMs || !row || typeof row !== 'object' || Array.isArray(row)) return row;
  const field = ['updated_at', 'created_at', 'logged_at'].find(key => row[key]);
  if (!field) return row;
  const ms = Date.parse(row[field]);
  if (!Number.isFinite(ms)) return row;
  return { ...row, [field]: new Date(ms + skewMs).toISOString() };
}

function correctRowsClock(rows, skewMs) {
  if (!skewMs || !Array.isArray(rows)) return rows;
  return rows.map(row => correctRowClock(row, skewMs));
}

function correctPatchClock(patch, skewMs) {
  if (!skewMs || !patch?.collections || typeof patch.collections !== 'object') return patch;
  Object.values(patch.collections).forEach(change => {
    if (change && Array.isArray(change.upsert)) change.upsert = correctRowsClock(change.upsert, skewMs);
  });
  return patch;
}

module.exports = {
  MIN_SKEW_MS,
  MAX_SKEW_MS,
  clientClockSkewMs,
  correctRowClock,
  correctRowsClock,
  correctPatchClock,
};
