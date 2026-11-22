#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const EXTRA_DISK_MB = 200;
const EXTRA_DISK_BYTES = EXTRA_DISK_MB * 1024 * 1024;

function parseArgs(argv) {
  const opts = { yes: false, db: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--yes') opts.yes = true;
    else if (arg.startsWith('--db=')) opts.db = arg.slice(5);
  }
  return opts;
}

function resolveDbPath(cliDb) {
  if (cliDb) return path.resolve(cliDb);
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch (_) {}
  const envPath = process.env.DB_PATH;
  return path.resolve(path.join(__dirname, '..'), envPath || './database/teampulse.db');
}

function backupFilenameStamp(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function fmtMb(bytes) {
  return (Number(bytes || 0) / (1024 * 1024)).toFixed(1);
}

function readFileMetrics(dbPath) {
  const st = fs.statSync(dbPath);
  return { file_bytes: st.size, file_mb: fmtMb(st.size) };
}

function readDbPragmas(db) {
  const pageSize = Number(db.pragma('page_size', { simple: true }) || 4096);
  const pageCount = Number(db.pragma('page_count', { simple: true }) || 0);
  const freelist = Number(db.pragma('freelist_count', { simple: true }) || 0);
  const autoVac = Number(db.pragma('auto_vacuum', { simple: true }) || 0);
  const walBytes = (() => {
    try {
      const walPath = `${db.name}-wal`;
      if (fs.existsSync(walPath)) return fs.statSync(walPath).size;
    } catch (_) {}
    return 0;
  })();
  return {
    page_size: pageSize,
    page_count: pageCount,
    freelist_count: freelist,
    freelist_bytes: freelist * pageSize,
    freelist_mb: fmtMb(freelist * pageSize),
    auto_vacuum: autoVac,
    wal_bytes: walBytes,
    wal_mb: fmtMb(walBytes),
  };
}

function listUserTables(db) {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => row.name);
}

function tableRowCounts(db) {
  const counts = {};
  for (const name of listUserTables(db)) {
    counts[name] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`).get().n || 0);
  }
  return counts;
}

function rowCountsEqual(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const key of keys) {
    if (Number(a?.[key]) !== Number(b?.[key])) return false;
  }
  return true;
}

function freeDiskBytes(filePath) {
  if (typeof fs.statfsSync !== 'function') return null;
  try {
    const st = fs.statfsSync(path.dirname(path.resolve(filePath)));
    const avail = typeof st.bavail === 'number' ? st.bavail : st.bfree;
    return Number(st.bsize) * Number(avail);
  } catch {
    return null;
  }
}

function requiredDiskBytes(fileBytes, freelistBytes, walBytes = 0) {
  const payload = Math.max(0, Number(fileBytes) - Number(freelistBytes || 0));
  return payload * 3 + Math.max(0, Number(walBytes || 0)) + EXTRA_DISK_BYTES;
}

function sqlVacuumIntoPath(filePath) {
  return String(filePath).replace(/'/g, "''");
}

function removeFileQuiet(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (_) {}
}

function vacuumIntoBackup(db, backupPath) {
  removeFileQuiet(backupPath);
  const escaped = sqlVacuumIntoPath(path.resolve(backupPath));
  db.exec(`VACUUM INTO '${escaped}'`);
}

function probeExclusiveWrite(db) {
  db.prepare('BEGIN IMMEDIATE').run();
  db.prepare('ROLLBACK').run();
}

function tableWithoutRowid(db, table) {
  const row = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type='table' AND name=?
  `).get(table);
  if (!row?.sql) return false;
  return /WITHOUT\s+ROWID/i.test(String(row.sql));
}

function pickSampleRow(db) {
  const tables = listUserTables(db);
  for (const table of tables) {
    if (tableWithoutRowid(db, table)) continue;
    try {
      const row = db.prepare(`SELECT rowid AS __rid, * FROM ${quoteIdent(table)} LIMIT 1`).get();
      if (row && row.__rid != null) {
        return { table, rowid: row.__rid, row };
      }
    } catch (_) {}
  }
  return null;
}

function sampleRowStillMatches(db, sample) {
  if (!sample) return true;
  const { table, rowid, row } = sample;
  const current = db.prepare(
    `SELECT rowid AS __rid, * FROM ${quoteIdent(table)} WHERE rowid=?`
  ).get(rowid);
  if (!current) return false;
  return Object.keys(row)
    .filter(col => col !== '__rid')
    .every(col => String(current[col]) === String(row[col]));
}

function integrityOk(db) {
  return db.pragma('integrity_check', { simple: true }) === 'ok';
}

function foreignKeysOk(db) {
  const violations = db.pragma('foreign_key_check');
  return !violations || violations.length === 0;
}

function printDryReport(dbPath, fileMetrics, pragmas, diskFree) {
  const need = requiredDiskBytes(fileMetrics.file_bytes, pragmas.freelist_bytes, pragmas.wal_bytes);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('فشرده‌سازی پایگاه داده SQLite (فقط با --yes اجرا می‌شود)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`مسیر: ${dbPath}`);
  console.log(`حجم فایل: ${fileMetrics.file_mb} مگابایت (${fileMetrics.file_bytes} بایت)`);
  console.log(`freelist: ${pragmas.freelist_count} صفحه (~${pragmas.freelist_mb} مگابایت)`);
  console.log(`WAL روی دیسک: ~${pragmas.wal_mb} مگابایت`);
  console.log(`auto_vacuum فعلی: ${pragmas.auto_vacuum} (۰=خاموش، ۲=incremental)`);
  if (diskFree == null) {
    console.log('فضای آزاد دیسک: نامشخص (statfs در این محیط در دسترس نیست)');
  } else {
    console.log(`فضای آزاد دیسک: ~${fmtMb(diskFree)} مگابایت`);
    console.log(`حداقل لازم برای فشرده‌سازی: ~${fmtMb(need)} مگابایت`);
    console.log('  (فرمول: (حجم فایل − freelist) × 3 + WAL + 200MB)');
  }
  console.log('');
  console.log('مراحل پیشنهادی با --yes:');
  console.log('  ۱) پشتیبان pre-compact (VACUUM INTO) + integrity_check + تطابق تعداد ردیف‌ها');
  console.log('  ۲) wal_checkpoint(TRUNCATE)؛ auto_vacuum=INCREMENTAL؛ VACUUM');
  console.log('  ۳) integrity_check، foreign_key_check، تطابق ردیف‌ها، auto_vacuum=2');
  console.log('');
  console.log('⚠ قبل از اجرا حتماً اپلیکیشن (Node/PM2) را متوقف کنید تا قفل نوشتن آزاد باشد.');
  console.log('برای اجرا: node scripts/db-compact.js --yes' + (process.argv.find(a => a.startsWith('--db=')) ? ` ${process.argv.find(a => a.startsWith('--db='))}` : ''));
}

function restoreInstructions(backupPath) {
  console.error('');
  console.error('❌ فشرده‌سازی کامل نشد. دیتابیس اصلی را دستی از پشتیبان بازگردانی کنید:');
  console.error(`   پشتیبان: ${backupPath}`);
  console.error('   ۱) اپ را متوقف کنید');
  console.error('   ۲) فایل فعلی teampulse.db (و -wal/-shm در صورت وجود) را کنار بگذارید');
  console.error('   ۳) پشتیبان را روی مسیر دیتابیس کپی/جایگزین کنید');
  console.error('   ۴) اپ را دوباره بالا بیاورید');
}

async function runCompact(options = {}) {
  const dbPath = resolveDbPath(options.db);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`فایل پایگاه داده یافت نشد: ${dbPath}`);
  }

  const fileMetrics = readFileMetrics(dbPath);
  const previewDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  const pragmasBefore = readDbPragmas(previewDb);
  previewDb.close();
  const diskFree = freeDiskBytes(dbPath);

  printDryReport(dbPath, fileMetrics, pragmasBefore, diskFree);
  if (!options.yes) {
    return { dryRun: true, dbPath, fileMetrics, pragmas: pragmasBefore, diskFree };
  }

  const needBytes = requiredDiskBytes(
    fileMetrics.file_bytes,
    pragmasBefore.freelist_bytes,
    pragmasBefore.wal_bytes
  );
  if (diskFree != null && diskFree < needBytes) {
    console.error(`❌ فضای دیسک کافی نیست. موجود: ~${fmtMb(diskFree)} مگ، نیاز: ~${fmtMb(needBytes)} مگ.`);
    process.exitCode = 1;
    return { aborted: true, reason: 'disk_space' };
  }
  if (diskFree == null) {
    console.warn('⚠ فضای دیسک قابل اندازه‌گیری نیست؛ ادامه با مسئولیت شما.');
  }

  let db;
  try {
    db = new Database(dbPath, { timeout: 5000, fileMustExist: true });
    db.pragma('foreign_keys = ON');
    probeExclusiveWrite(db);
  } catch (error) {
    console.error('❌ نتوانستیم قفل انحصاری نوشتن بگیریم. اپلیکیشن را متوقف کنید و دوباره تلاش کنید.');
    console.error(`   جزئیات: ${error.message}`);
    process.exitCode = 1;
    return { aborted: true, reason: 'write_lock', error };
  }

  const backupPath = path.join(
    path.dirname(dbPath),
    `pre-compact-${backupFilenameStamp(Date.now())}.db`
  );
  const countsBefore = tableRowCounts(db);
  const sample = pickSampleRow(db);

  try {
    vacuumIntoBackup(db, backupPath);
  } catch (error) {
    removeFileQuiet(backupPath);
    console.error(`❌ ساخت پشتیبان (VACUUM INTO) ناموفق: ${error.message}`);
    process.exitCode = 1;
    db.close();
    return { aborted: true, reason: 'backup_failed', error };
  }

  const backupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
  if (!integrityOk(backupDb)) {
    console.error('❌ integrity_check پشتیبان ok نیست. فشرده‌سازی متوقف شد.');
    backupDb.close();
    db.close();
    process.exitCode = 1;
    return { aborted: true, reason: 'backup_integrity' };
  }
  if (!rowCountsEqual(countsBefore, tableRowCounts(backupDb))) {
    console.error('❌ تعداد ردیف‌های پشتیبان با دیتابیس اصلی یکسان نیست.');
    backupDb.close();
    db.close();
    process.exitCode = 1;
    return { aborted: true, reason: 'backup_row_mismatch' };
  }
  backupDb.close();

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('auto_vacuum = 2');
    db.exec('VACUUM');
  } catch (error) {
    console.error(`❌ VACUUM ناموفق: ${error.message}`);
    restoreInstructions(backupPath);
    db.close();
    process.exitCode = 1;
    return { aborted: true, reason: 'vacuum_failed', backupPath, error };
  }

  if (!integrityOk(db)) {
    console.error('❌ integrity_check پس از فشرده‌سازی ok نیست.');
    restoreInstructions(backupPath);
    db.close();
    process.exitCode = 1;
    return { aborted: true, reason: 'post_integrity', backupPath };
  }
  if (!foreignKeysOk(db)) {
    console.error('❌ foreign_key_check پس از فشرده‌سازی خطا دارد.');
    restoreInstructions(backupPath);
    db.close();
    process.exitCode = 1;
    return { aborted: true, reason: 'post_fk', backupPath };
  }
  const countsAfter = tableRowCounts(db);
  if (!rowCountsEqual(countsBefore, countsAfter)) {
    console.error('❌ تعداد ردیف‌ها پس از فشرده‌سازی تغییر کرده است.');
    restoreInstructions(backupPath);
    db.close();
    process.exitCode = 1;
    return { aborted: true, reason: 'post_row_mismatch', backupPath };
  }
  if (!sampleRowStillMatches(db, sample)) {
    console.error('❌ نمونه ردیف پس از فشرده‌سازی تغییر کرده است.');
    restoreInstructions(backupPath);
    db.close();
    process.exitCode = 1;
    return { aborted: true, reason: 'post_sample', backupPath };
  }
  const autoAfter = Number(db.pragma('auto_vacuum', { simple: true }));
  if (autoAfter !== 2) {
    console.error(`❌ auto_vacuum پس از فشرده‌سازی برابر ۲ نیست (فعلی: ${autoAfter}).`);
    restoreInstructions(backupPath);
    db.close();
    process.exitCode = 1;
    return { aborted: true, reason: 'post_auto_vacuum', backupPath };
  }

  const pragmasAfter = readDbPragmas(db);
  const fileAfter = readFileMetrics(dbPath);
  db.close();

  console.log('');
  console.log('✅ فشرده‌سازی با موفقیت انجام شد.');
  console.log(`حجم قبل: ${fileMetrics.file_mb} مگ  →  بعد: ${fileAfter.file_mb} مگ`);
  console.log(`freelist قبل: ${pragmasBefore.freelist_count} صفحه  →  بعد: ${pragmasAfter.freelist_count} صفحه`);
  console.log(`auto_vacuum: ${pragmasBefore.auto_vacuum} → ${pragmasAfter.auto_vacuum}`);
  console.log(`پشتیبان (نگه‌داشته شد): ${backupPath}`);

  return {
    dryRun: false,
    ok: true,
    dbPath,
    backupPath,
    file_before: fileMetrics,
    file_after: fileAfter,
    pragmas_before: pragmasBefore,
    pragmas_after: pragmasAfter,
    sample,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  try {
    await runCompact({ yes: opts.yes, db: opts.db });
  } catch (error) {
    console.error(`❌ خطا: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  resolveDbPath,
  readDbPragmas,
  tableRowCounts,
  rowCountsEqual,
  requiredDiskBytes,
  pickSampleRow,
  sampleRowStillMatches,
  vacuumIntoBackup,
  runCompact,
};