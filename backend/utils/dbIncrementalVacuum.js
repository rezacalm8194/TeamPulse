'use strict';

// Nightly incremental_vacuum when the database was compacted with auto_vacuum=INCREMENTAL.

const TEHRAN_OFFSET_MS = 210 * 60 * 1000;
const FREELIST_TARGET_PAGES = 2000;
const PAGES_PER_ROUND = 5000;
const MAX_ROUNDS = 50;

function tehranParts(ms) {
  const d = new Date(ms + TEHRAN_OFFSET_MS);
  return {
    dateKey: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

function runIncrementalVacuumPass(db, {
  freelistTarget = FREELIST_TARGET_PAGES,
  pagesPerRound = PAGES_PER_ROUND,
  maxRounds = MAX_ROUNDS,
  logger = null,
} = {}) {
  const autoVac = Number(db.pragma('auto_vacuum', { simple: true }));
  if (autoVac !== 2) {
    logger?.info?.('incremental_vacuum_skipped', { auto_vacuum: autoVac });
    return { skipped: true, reason: 'auto_vacuum_not_incremental', auto_vacuum: autoVac };
  }
  let rounds = 0;
  let freelist = Number(db.pragma('freelist_count', { simple: true }) || 0);
  while (freelist > freelistTarget && rounds < maxRounds) {
    try {
      db.pragma(`incremental_vacuum(${pagesPerRound})`);
    } catch (error) {
      logger?.error?.('incremental_vacuum_round_failed', { round: rounds, error });
      break;
    }
    rounds += 1;
    freelist = Number(db.pragma('freelist_count', { simple: true }) || 0);
  }
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch (error) {
    logger?.error?.('wal_checkpoint_passive_failed', { error });
  }
  return { skipped: false, rounds, freelist_start: null, freelist_end: freelist };
}

async function runIncrementalVacuumPassAsync(db, options = {}) {
  const autoVac = Number(db.pragma('auto_vacuum', { simple: true }));
  if (autoVac !== 2) {
    options.logger?.info?.('incremental_vacuum_skipped', { auto_vacuum: autoVac });
    return { skipped: true, reason: 'auto_vacuum_not_incremental', auto_vacuum: autoVac };
  }
  const freelistTarget = options.freelistTarget ?? FREELIST_TARGET_PAGES;
  const pagesPerRound = options.pagesPerRound ?? PAGES_PER_ROUND;
  const maxRounds = options.maxRounds ?? MAX_ROUNDS;
  const logger = options.logger;
  let rounds = 0;
  let freelist = Number(db.pragma('freelist_count', { simple: true }) || 0);
  const freelistStart = freelist;
  while (freelist > freelistTarget && rounds < maxRounds) {
    try {
      db.pragma(`incremental_vacuum(${pagesPerRound})`);
    } catch (error) {
      logger?.error?.('incremental_vacuum_round_failed', { round: rounds, error });
      break;
    }
    rounds += 1;
    freelist = Number(db.pragma('freelist_count', { simple: true }) || 0);
    await new Promise(resolve => setImmediate(resolve));
  }
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch (error) {
    logger?.error?.('wal_checkpoint_passive_failed', { error });
  }
  return { skipped: false, rounds, freelist_start: freelistStart, freelist_end: freelist };
}

function startNightlyIncrementalVacuum(db, {
  logger = null,
  hour = 3,
  minute = 30,
  intervalMs = 5 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  if (!db) return null;
  const target = hour * 60 + minute;
  let lastDateKey = null;
  let running = false;

  const tick = async () => {
    if (running) return false;
    const t = now();
    const { dateKey, minutes } = tehranParts(t);
    if (minutes < target) return false;
    if (lastDateKey === dateKey) return false;
    running = true;
    try {
      const result = await runIncrementalVacuumPassAsync(db, { logger });
      if (!result.skipped) {
        lastDateKey = dateKey;
        logger?.info?.('incremental_vacuum_nightly', result);
        return true;
      }
      return false;
    } catch (error) {
      logger?.error?.('incremental_vacuum_nightly_failed', { error });
      return false;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = {
  FREELIST_TARGET_PAGES,
  PAGES_PER_ROUND,
  MAX_ROUNDS,
  TEHRAN_OFFSET_MS,
  tehranParts,
  runIncrementalVacuumPass,
  runIncrementalVacuumPassAsync,
  startNightlyIncrementalVacuum,
};