'use strict';

// Nightly consistent copy of the live SQLite database.
//
// The host (Pachim) backs up the site folder every night around 00:05 by
// copying files. teampulse.db runs in WAL mode, so a plain file copy taken
// while the app is writing can capture a .db and .db-wal that don't belong
// together. better-sqlite3's online backup API produces a self-contained,
// transactionally consistent copy, so the host backup that follows always
// contains at least one database that is guaranteed to open cleanly.
//
// Only one snapshot is kept (written to a temp file, then atomically renamed),
// so the extra disk use is one copy of the database.

const fs = require('fs');
const path = require('path');

// Iran has observed a fixed UTC+03:30 since DST was abolished in 2022.
const TEHRAN_OFFSET_MS = 210 * 60 * 1000;
const SNAPSHOT_FILE = 'teampulse-snapshot.db';
const META_FILE = 'teampulse-snapshot.json';

function tehranParts(ms) {
  const d = new Date(ms + TEHRAN_OFFSET_MS);
  return {
    dateKey: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

function readLastSnapshotDateKey(dir, io = fs) {
  try {
    const meta = JSON.parse(io.readFileSync(path.join(dir, META_FILE), 'utf8'));
    return typeof meta?.tehran_date === 'string' ? meta.tehran_date : null;
  } catch (_) {
    return null;
  }
}

async function writeDbSnapshot(db, dir, { io = fs, now = Date.now() } = {}) {
  io.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, SNAPSHOT_FILE);
  const tmpPath = finalPath + '.tmp';
  try { io.unlinkSync(tmpPath); } catch (_) {}
  try {
    await db.backup(tmpPath);
    io.renameSync(tmpPath, finalPath);
  } catch (error) {
    try { io.unlinkSync(tmpPath); } catch (_) {}
    throw error;
  }
  const bytes = io.statSync(finalPath).size;
  const meta = {
    created_at: new Date(now).toISOString(),
    tehran_date: tehranParts(now).dateKey,
    bytes,
  };
  io.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta, null, 2));
  return meta;
}

function startNightlyDbSnapshot(db, {
  dir,
  logger = null,
  hour = 23,
  minute = 30,
  intervalMs = 5 * 60 * 1000,
  now = () => Date.now(),
  io = fs,
} = {}) {
  if (!db || typeof db.backup !== 'function' || !dir) return null;
  const target = hour * 60 + minute;
  let lastDateKey = readLastSnapshotDateKey(dir, io);
  let running = false;

  async function tick() {
    if (running) return false;
    const t = now();
    const { dateKey, minutes } = tehranParts(t);
    // Window runs from the target time until midnight Tehran. A restart
    // inside the window still takes tonight's copy; a failure retries on
    // the next tick.
    if (minutes < target || dateKey === lastDateKey) return false;
    running = true;
    const startedAt = Date.now();
    try {
      const meta = await writeDbSnapshot(db, dir, { io, now: t });
      lastDateKey = dateKey;
      logger?.info?.('db_snapshot_written', { bytes: meta.bytes, ms: Date.now() - startedAt });
      return true;
    } catch (error) {
      logger?.error?.('db_snapshot_failed', { error });
      return false;
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = {
  SNAPSHOT_FILE,
  META_FILE,
  tehranParts,
  readLastSnapshotDateKey,
  writeDbSnapshot,
  startNightlyDbSnapshot,
};
