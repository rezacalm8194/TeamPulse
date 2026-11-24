// Lightweight due-index for the push reminder cron.
const { ensureAccountTrashSchema } = require('./accountTrash');
// The cron must not load every active account's JSON every minute.

const { isPaymentReminder, reminderPausedByArchive } = require('./reminderKind');

const IRAN_OFFSET_MS = (3 * 60 + 30) * 60 * 1000;
const PUSH_CATCH_UP_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_UNINDEXED = 40;
// Accounts whose index has expired (daily horizon passed) and are rebuilt per
// cron tick. Habits/recurring todos keep a two-day lookahead, so a slow
// midnight backlog never makes a reminder late.
const DEFAULT_MAX_EXPIRED = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
// Failed deliveries back off instead of being retried every minute.
const RETRY_BASE_MS = 60 * 1000;
const RETRY_MAX_MS = 30 * 60 * 1000;

function jalaliToGregorian(jy, jm, jd) {
  const div = (a, b) => Math.floor(a / b);
  const mod = (a, b) => a - div(a, b) * b;
  let gy = (jy <= 979) ? 621 : 1600;
  jy -= (jy <= 979) ? 0 : 979;
  let days = (365 * jy) + (div(jy, 33) * 8) + div(mod(jy, 33) + 3, 4) + 78 + jd
    + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30 + 186));
  gy += 400 * div(days, 146097);
  days = mod(days, 146097);
  if (days > 36524) { gy += 100 * div(--days, 36524); days = mod(days, 36524); if (days >= 365) days++; }
  gy += 4 * div(days, 1461);
  days = mod(days, 1461);
  gy += div(days - 1, 365);
  if (days > 365) days = mod(days - 1, 365);
  let gd = days + 1;
  const sal_a = [0,31,((gy%4===0&&gy%100!==0)||gy%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  let gm = 0;
  for (gm = 1; gm <= 12 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
  return [gy, gm, gd];
}

function gregorianToJalali(gy, gm, gd) {
  const div = (a, b) => Math.floor(a / b);
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = 355666 + (365 * gy) + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + gdm[gm - 1];
  let jy = -1595 + (33 * div(days, 12053));
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = (days < 186) ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return [jy, jm, jd];
}

function jalaliDaysInMonth(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  const [gy, gm, gd] = jalaliToGregorian(jy, 12, 30);
  const back = gregorianToJalali(gy, gm, gd);
  return back[0] === jy && back[1] === 12 && back[2] === 30 ? 30 : 29;
}

function formatJalaliFa(jy, jm, jd) {
  const fa = value => String(value).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  return `${fa(jy)}/${fa(String(jm).padStart(2, '0'))}/${fa(String(jd).padStart(2, '0'))}`;
}

function parseJalali(str) {
  if (!str) return null;
  const p = '۰۱۲۳۴۵۶۷۸۹';
  const s = str.split('').map(c => { const i = p.indexOf(c); return i >= 0 ? String(i) : c; }).join('');
  const parts = s.split('/').map(Number);
  return (parts.length === 3 && !parts.some(isNaN)) ? parts : null;
}

function jalaliToUTC(dateJalali, timeStr) {
  const parts = parseJalali(dateJalali);
  if (!parts) return null;
  const [jy, jm, jd] = parts;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  return new Date(Date.UTC(gy, gm - 1, gd, h, m, 0) - IRAN_OFFSET_MS);
}

function iranTodayParts(now = new Date()) {
  const iranNow = new Date(now.getTime() + IRAN_OFFSET_MS);
  const gy = iranNow.getUTCFullYear();
  const gm = iranNow.getUTCMonth() + 1;
  const gd = iranNow.getUTCDate();
  return {
    gy, gm, gd,
    key: `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`,
  };
}

function iranWallTimeToUTC(gy, gm, gd, timeStr) {
  const [h, m] = (timeStr || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return new Date(Date.UTC(gy, gm - 1, gd, h, m, 0) - IRAN_OFFSET_MS);
}

function iranNineAmUtc(gy, gm, gd) {
  return new Date(Date.UTC(gy, gm - 1, gd, 9, 0, 0) - IRAN_OFFSET_MS);
}

function jalaliDayKey(value) {
  const parts = parseJalali(value);
  if (!parts) return null;
  const [gy, gm, gd] = jalaliToGregorian(parts[0], parts[1], parts[2]);
  return gy * 10000 + gm * 100 + gd;
}

function gregorianDayKeyToParts(dayKey) {
  const gy = Math.floor(dayKey / 10000);
  const gm = Math.floor((dayKey % 10000) / 100);
  const gd = dayKey % 100;
  return { gy, gm, gd };
}

function ensurePushDueIndexSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_due_index (
      account_id TEXT PRIMARY KEY,
      data_etag TEXT,
      next_timed_ms INTEGER,
      next_daily_ms INTEGER,
      indexed_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_push_due_index_timed
      ON push_due_index(next_timed_ms);
    CREATE INDEX IF NOT EXISTS idx_push_due_index_daily
      ON push_due_index(next_daily_ms);
    CREATE TABLE IF NOT EXISTS push_due_items (
      delivery_key TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      due_ms INTEGER NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_push_due_items_due
      ON push_due_items(due_ms, account_id);
    CREATE INDEX IF NOT EXISTS idx_push_due_items_account
      ON push_due_items(account_id, due_ms);
  `);
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account ON push_subscriptions(account_id)');
  } catch (_) { /* table is created by the reminders route */ }
  if (!migratedDbs.has(db)) {
    addColumnIfMissing(db, 'push_due_index', 'valid_until_ms', 'valid_until_ms INTEGER');
    addColumnIfMissing(db, 'push_due_items', 'attempts', 'attempts INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'push_due_items', 'next_attempt_ms', 'next_attempt_ms INTEGER');
    migratedDbs.add(db);
  }
}

const migratedDbs = new WeakSet();

function addColumnIfMissing(db, table, name, ddl) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(col => col.name);
    if (cols.length && !cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch (_) { /* best effort: older test schemas */ }
}

function loadDeliveredKeys(db, accountId) {
  try {
    return new Set(
      db.prepare('SELECT delivery_key FROM push_deliveries WHERE account_id=?')
        .all(accountId)
        .map(row => row.delivery_key)
    );
  } catch {
    return new Set();
  }
}

function upsertPushDueIndex(db, accountId, dataEtag, schedule) {
  ensurePushDueIndexSchema(db);
  db.prepare(`
    INSERT INTO push_due_index (account_id, data_etag, next_timed_ms, next_daily_ms, valid_until_ms, indexed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(account_id) DO UPDATE SET
      data_etag=excluded.data_etag,
      next_timed_ms=excluded.next_timed_ms,
      next_daily_ms=excluded.next_daily_ms,
      valid_until_ms=excluded.valid_until_ms,
      indexed_at=datetime('now')
  `).run(
    accountId,
    dataEtag || '',
    schedule?.nextTimedMs ?? null,
    schedule?.nextDailyMs ?? null,
    schedule?.validUntilMs ?? null
  );
}

function todoScheduledDate(todo) {
  return todo?.scheduled_date || todo?.scheduledDate || todo?.date_jalali || '';
}

function todoBelongsToAccount(todo, accountId) {
  const taskOwnerId = String(todo?.owner_id || todo?.ownerId || '').trim();
  if (!taskOwnerId) return true;
  if (taskOwnerId === 'local-owner') return true;
  return taskOwnerId === String(accountId);
}

function isCatchableOrFuture(ms, nowMs, catchUpMs) {
  if (ms == null || Number.isNaN(ms)) return false;
  return (nowMs - ms) <= catchUpMs;
}

function takeMin(current, next) {
  if (next == null || Number.isNaN(next)) return current;
  if (current == null || next < current) return next;
  return current;
}

function dailyFireMs(dueJalali, today) {
  const dueDayKey = jalaliDayKey(dueJalali);
  if (!dueDayKey) return null;
  const todayDayKey = today.gy * 10000 + today.gm * 100 + today.gd;
  if (dueDayKey > todayDayKey) {
    const { gy, gm, gd } = gregorianDayKeyToParts(dueDayKey);
    return iranNineAmUtc(gy, gm, gd).getTime();
  }
  return iranNineAmUtc(today.gy, today.gm, today.gd).getTime();
}

const WEEKDAY_NAMES = { sat: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };

function utcDayFromKey(dayKey) {
  const { gy, gm, gd } = gregorianDayKeyToParts(dayKey);
  return new Date(Date.UTC(gy, gm - 1, gd));
}

// Same rules the client uses to advance a recurring task (app.js
// _advanceTodoDate / _calcNextRepeatDate), evaluated for one calendar day.
function todoRepeatMatchesDay(todo, anchorDayKey, dayKey) {
  const repeat = String(todo?.repeat || 'none');
  if (dayKey === anchorDayKey) return true;
  if (dayKey < anchorDayKey) return false;
  const day = utcDayFromKey(dayKey);
  const anchor = utcDayFromKey(anchorDayKey);
  if (repeat === 'daily') return true;
  if (repeat === 'every2days') return Math.round((day - anchor) / DAY_MS) % 2 === 0;
  if (repeat === 'weekly') return day.getUTCDay() === anchor.getUTCDay();
  if (repeat === 'custom_weekdays') {
    const wanted = String(todo?.weekdays || '').split(',').map(v => v.trim()).filter(Boolean);
    if (!wanted.length) return false;
    return wanted.some(name => WEEKDAY_NAMES[name] === day.getUTCDay());
  }
  if (repeat === 'monthly') {
    const [ay, am, ad] = gregorianToJalali(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, anchor.getUTCDate());
    void ay; void am;
    const [jy, jm, jd] = gregorianToJalali(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    return jd === Math.min(ad, jalaliDaysInMonth(jy, jm));
  }
  return false;
}

// Dates (jalali strings) a todo should be reminded on. A recurring task whose
// stored date is in the past (not ticked yet) still gets its next occurrences;
// before this, the server only looked at the stored date and went silent.
function todoReminderDates(todo, today) {
  const scheduledDate = todoScheduledDate(todo);
  const repeat = String(todo?.repeat || 'none');
  const anchorDayKey = jalaliDayKey(scheduledDate);
  if (!anchorDayKey || repeat === 'none') return [scheduledDate];
  const todayDayKey = today.gy * 10000 + today.gm * 100 + today.gd;
  const dates = [scheduledDate];
  if (anchorDayKey > todayDayKey + 2) return dates;
  // today .. today+2 covers remind_min up to one day before.
  for (let i = 0; i <= 2; i++) {
    const d = new Date(Date.UTC(today.gy, today.gm - 1, today.gd + i));
    const dayKey = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    if (dayKey <= anchorDayKey) continue;
    if (!todoRepeatMatchesDay(todo, anchorDayKey, dayKey)) continue;
    const [jy, jm, jd] = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    dates.push(formatJalaliFa(jy, jm, jd));
  }
  return dates;
}

function compactTodo(todo) {
  return {
    id: todo?.id,
    title: todo?.title,
    time: todo?.time,
    note: todo?.note,
    remind_min: todo?.remind_min,
    scheduled_date: todoScheduledDate(todo),
    owner_id: todo?.owner_id || todo?.ownerId || null,
    assignee_id: todo?.assignee_id ?? todo?.assigneeId ?? null,
    staff_id: todo?.staff_id ?? todo?.staffId ?? null,
    assignee_email: todo?.assignee_email || todo?.assigneeEmail || null,
  };
}

function personNameFrom(rows, id) {
  const row = (rows || []).find(item => String(item?.id) === String(id));
  if (!row) return '';
  return `${row.name || ''} ${row.lname || ''}`.trim();
}

function pushItem(items, deliveryKey, kind, dueMs, payload) {
  if (dueMs == null || Number.isNaN(dueMs)) return;
  items.push({ deliveryKey, kind, dueMs, payload: payload || {} });
}

function computePushDueIndex(accountId, userData, now, deliveredKeys, options = {}) {
  const catchUpMs = options.catchUpMs ?? PUSH_CATCH_UP_MS;
  const nowMs = now.getTime();
  const today = iranTodayParts(now);
  const delivered = deliveredKeys || new Set();
  const items = [];
  let nextTimedMs = null;
  let nextDailyMs = null;

  for (const t of (userData?.todos || [])) {
    const scheduledDate = todoScheduledDate(t);
    if (t.done || t.archived || !t.time || !scheduledDate || !(Number(t.remind_min) > 0)) continue;
    if (!todoBelongsToAccount(t, accountId)) continue;
    for (const occurrenceDate of todoReminderDates(t, today)) {
      const taskUTC = jalaliToUTC(occurrenceDate, t.time);
      if (!taskUTC) continue;
      const notifMs = taskUTC.getTime() - t.remind_min * 60000;
      const key = `todo:${accountId}:${t.id}:${occurrenceDate}:${t.time}:${t.remind_min}`;
      if (delivered.has(key)) continue;
      if (!isCatchableOrFuture(notifMs, nowMs, catchUpMs)) continue;
      nextTimedMs = takeMin(nextTimedMs, notifMs);
      pushItem(items, key, 'todo', notifMs, {
        title: t.title,
        time: t.time,
        note: t.note || '',
        todo: { ...compactTodo(t), scheduled_date: occurrenceDate },
      });
    }
  }

  for (const h of (userData?.habits || [])) {
    if (h.archived) continue;
    for (const rem of (h.custom_reminders || [])) {
      if (!rem || rem.done || !rem.time) continue;
      const action = String(rem.action || '').trim();
      const occurrences = [];
      if ((rem.repeat || 'once') === 'weekly' && rem.date) {
        const remParts = parseJalali(rem.date);
        let remDow = null;
        if (remParts) {
          const [rgy, rgm, rgd] = jalaliToGregorian(remParts[0], remParts[1], remParts[2]);
          remDow = new Date(Date.UTC(rgy, rgm - 1, rgd)).getUTCDay();
        }
        if (remDow != null) {
          for (let i = 0; i < 8; i++) {
            const d = new Date(Date.UTC(today.gy, today.gm - 1, today.gd + i));
            if (d.getUTCDay() !== remDow) continue;
            const gy = d.getUTCFullYear();
            const gm = d.getUTCMonth() + 1;
            const gd = d.getUTCDate();
            const utc = iranWallTimeToUTC(gy, gm, gd, rem.time);
            if (utc) occurrences.push({ dateKey: `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`, utc });
          }
        }
      } else if (rem.date) {
        const utc = jalaliToUTC(rem.date, rem.time);
        if (utc) occurrences.push({ dateKey: rem.date, utc });
      }
      for (const occ of occurrences) {
        const notifMs = occ.utc.getTime();
        const key = `habit-custom:${accountId}:${h.id}:${rem.id}:${occ.dateKey}:${rem.time}`;
        if (delivered.has(key) || !isCatchableOrFuture(notifMs, nowMs, catchUpMs)) continue;
        nextTimedMs = takeMin(nextTimedMs, notifMs);
        pushItem(items, key, 'habit', notifMs, {
          title: h.title,
          time: rem.time,
          desc: action,
          action,
          habitId: h.id,
          custom: true,
        });
      }
    }
    if (!h.time || !(h.remind_min > 0)) continue;
    const habitUTC = iranWallTimeToUTC(today.gy, today.gm, today.gd, h.time);
    if (!habitUTC) continue;
    const notifMs = habitUTC.getTime() - h.remind_min * 60000;
    const key = `habit:${accountId}:${h.id}:${today.key}:${h.time}:${h.remind_min}`;
    if (!delivered.has(key) && isCatchableOrFuture(notifMs, nowMs, catchUpMs)) {
      nextTimedMs = takeMin(nextTimedMs, notifMs);
      pushItem(items, key, 'habit', notifMs, {
        title: h.title,
        time: h.time,
        desc: h.desc || '',
        habitId: h.id,
      });
    }
    const tomorrow = new Date(Date.UTC(today.gy, today.gm - 1, today.gd + 1));
    const nextHabit = iranWallTimeToUTC(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
      h.time
    );
    if (nextHabit) {
      const nextMs = nextHabit.getTime() - h.remind_min * 60000;
      const tomorrowKey = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`;
      const nextKey = `habit:${accountId}:${h.id}:${tomorrowKey}:${h.time}:${h.remind_min}`;
      nextTimedMs = takeMin(nextTimedMs, nextMs);
      if (!delivered.has(nextKey)) {
        pushItem(items, nextKey, 'habit', nextMs, {
          title: h.title,
          time: h.time,
          desc: h.desc || '',
          habitId: h.id,
        });
      }
    }
  }

  for (const r of (userData?.reminders || [])) {
    if (r.done || !isPaymentReminder(r) || reminderPausedByArchive(r, userData)) continue;
    const key = `financial:${accountId}:${r.id}:${r.due_date_jalali}`;
    if (delivered.has(key)) continue;
    const dueMs = dailyFireMs(r.due_date_jalali, today);
    nextDailyMs = takeMin(nextDailyMs, dueMs);
    pushItem(items, key, 'financial-reminder', dueMs, {
      title: r.title,
      due_date_jalali: r.due_date_jalali,
      amount: r.amount,
      note: r.note || '',
      reminderId: r.id,
      personName: personNameFrom(userData?.students, r.student_id),
    });
  }
  for (const r of (userData?.staff_reminders || [])) {
    if (r.done) continue;
    const key = `staff:${accountId}:${r.id}:${r.due_date_jalali}`;
    if (delivered.has(key)) continue;
    const dueMs = dailyFireMs(r.due_date_jalali, today);
    nextDailyMs = takeMin(nextDailyMs, dueMs);
    pushItem(items, key, 'staff-reminder', dueMs, {
      title: r.title,
      due_date_jalali: r.due_date_jalali,
      amount: r.amount,
      note: r.note || '',
      reminderId: r.id,
      personName: personNameFrom(userData?.staff, r.staff_id),
    });
  }
  for (const e of (userData?.key_events || [])) {
    if (e.remind_done) continue;
    const key = `key-event:${accountId}:${e.id}:${e.remind_date}`;
    if (delivered.has(key)) continue;
    const dueMs = dailyFireMs(e.remind_date, today);
    nextDailyMs = takeMin(nextDailyMs, dueMs);
    pushItem(items, key, 'key-event', dueMs, {
      text: e.text || '',
      eventId: e.id,
      personName: personNameFrom(userData?.students, e.student_id),
    });
  }

  // Habits, weekly custom reminders and recurring todos only look a couple of
  // days ahead, so the index must be rebuilt every day even when the account's
  // data never changes (user did not open the app).
  const tomorrowStart = new Date(Date.UTC(today.gy, today.gm - 1, today.gd + 1) - IRAN_OFFSET_MS);
  const validUntilMs = tomorrowStart.getTime() + 60 * 1000;

  return { nextTimedMs, nextDailyMs, validUntilMs, items };
}

function replacePushDueItems(db, accountId, items) {
  ensurePushDueIndexSchema(db);
  const del = db.prepare('DELETE FROM push_due_items WHERE account_id=?');
  const ins = db.prepare(`
    INSERT INTO push_due_items (delivery_key, account_id, kind, due_ms, payload)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    del.run(accountId);
    for (const item of items || []) {
      if (!item?.deliveryKey || item.dueMs == null) continue;
      ins.run(
        item.deliveryKey,
        accountId,
        item.kind || 'reminder',
        item.dueMs,
        JSON.stringify(item.payload || {})
      );
    }
  });
  tx();
}

function deletePushDueItem(db, deliveryKey) {
  try {
    db.prepare('DELETE FROM push_due_items WHERE delivery_key=?').run(deliveryKey);
  } catch (_) { /* schema may be missing in isolated tests */ }
}

function refreshAccountScheduleFromItems(db, accountId) {
  ensurePushDueIndexSchema(db);
  const row = db.prepare(`
    SELECT
      MIN(CASE WHEN kind IN ('todo', 'habit') THEN due_ms END) AS next_timed_ms,
      MIN(CASE WHEN kind IN ('financial-reminder', 'staff-reminder', 'key-event') THEN due_ms END) AS next_daily_ms
    FROM push_due_items
    WHERE account_id=?
  `).get(accountId);
  db.prepare(`
    UPDATE push_due_index
    SET next_timed_ms=?, next_daily_ms=?, indexed_at=datetime('now')
    WHERE account_id=?
  `).run(row?.next_timed_ms ?? null, row?.next_daily_ms ?? null, accountId);
}

function parseDuePayload(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function listDuePushItems(db, now, options = {}) {
  ensurePushDueIndexSchema(db);
  ensureAccountTrashSchema(db);
  const nowMs = now.getTime();
  const limit = options.limit ?? 250;
  const catchUpMs = options.catchUpMs ?? PUSH_CATCH_UP_MS;
  return db.prepare(`
    SELECT i.delivery_key AS deliveryKey, i.account_id AS accountId, i.kind AS kind,
           i.due_ms AS dueMs, i.payload AS payload, i.attempts AS attempts
    FROM push_due_items i
    INNER JOIN accounts a ON a.id = i.account_id
    WHERE a.is_active = 1
      AND a.deleted_at IS NULL
      AND i.due_ms <= ?
      AND i.due_ms >= ?
      AND COALESCE(i.next_attempt_ms, 0) <= ?
      AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.account_id = i.account_id)
    ORDER BY COALESCE(i.next_attempt_ms, i.due_ms) ASC
    LIMIT ?
  `).all(nowMs, nowMs - catchUpMs, nowMs, limit).map(row => ({
    ...row,
    payload: parseDuePayload(row.payload),
  }));
}

// A delivery that could not reach any device (no matching subscription, push
// service error) waits with exponential backoff instead of being retried every
// minute ahead of everybody else's reminders.
function markPushDueItemFailed(db, deliveryKey, now, options = {}) {
  ensurePushDueIndexSchema(db);
  const nowMs = now.getTime();
  const row = db.prepare('SELECT attempts FROM push_due_items WHERE delivery_key=?').get(deliveryKey);
  if (!row) return null;
  const attempts = Number(row.attempts || 0) + 1;
  const base = options.retryBaseMs ?? RETRY_BASE_MS;
  const max = options.retryMaxMs ?? RETRY_MAX_MS;
  const delay = Math.min(max, base * (2 ** Math.min(attempts - 1, 20)));
  const nextAttemptMs = nowMs + delay;
  db.prepare('UPDATE push_due_items SET attempts=?, next_attempt_ms=? WHERE delivery_key=?')
    .run(attempts, nextAttemptMs, deliveryKey);
  return { attempts, nextAttemptMs };
}

// Items older than the catch-up window can never be sent on time any more.
function pruneStalePushDueItems(db, now, options = {}) {
  ensurePushDueIndexSchema(db);
  const catchUpMs = options.catchUpMs ?? PUSH_CATCH_UP_MS;
  const result = db.prepare('DELETE FROM push_due_items WHERE due_ms < ?').run(now.getTime() - catchUpMs);
  return result.changes || 0;
}

function listPushReindexAccountIds(db, now, options = {}) {
  ensurePushDueIndexSchema(db);
  ensureAccountTrashSchema(db);
  const maxUnindexed = options.maxUnindexed ?? DEFAULT_MAX_UNINDEXED;
  const dirty = db.prepare(`
    SELECT a.id AS id
    FROM accounts a
    INNER JOIN push_due_index i ON i.account_id = a.id
    LEFT JOIN user_data u ON u.account_id = a.id
    WHERE a.is_active = 1
      AND a.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.account_id = a.id)
      AND IFNULL(i.data_etag, '') != IFNULL(u.data_etag, '')
  `).all();

  const unindexed = db.prepare(`
    SELECT a.id AS id
    FROM accounts a
    WHERE a.is_active = 1
      AND a.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.account_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM push_due_index i WHERE i.account_id = a.id)
    LIMIT ?
  `).all(maxUnindexed);

  const maxExpired = options.maxExpired ?? DEFAULT_MAX_EXPIRED;
  const expired = db.prepare(`
    SELECT a.id AS id
    FROM accounts a
    INNER JOIN push_due_index i ON i.account_id = a.id
    WHERE a.is_active = 1
      AND a.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.account_id = a.id)
      AND IFNULL(i.valid_until_ms, 0) <= ?
    ORDER BY IFNULL(i.valid_until_ms, 0) ASC
    LIMIT ?
  `).all(now.getTime(), maxExpired);

  const seen = new Set();
  const ids = [];
  for (const row of [...dirty, ...unindexed, ...expired]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
  }
  return ids;
}

function listPushScanAccountIds(db, now, options = {}) {
  return listPushReindexAccountIds(db, now, options);
}

module.exports = {
  IRAN_OFFSET_MS,
  PUSH_CATCH_UP_MS,
  DEFAULT_MAX_UNINDEXED,
  jalaliToGregorian,
  gregorianToJalali,
  parseJalali,
  jalaliToUTC,
  iranTodayParts,
  iranWallTimeToUTC,
  iranNineAmUtc,
  jalaliDayKey,
  ensurePushDueIndexSchema,
  loadDeliveredKeys,
  upsertPushDueIndex,
  computePushDueIndex,
  replacePushDueItems,
  deletePushDueItem,
  refreshAccountScheduleFromItems,
  listDuePushItems,
  listPushReindexAccountIds,
  listPushScanAccountIds,
  markPushDueItemFailed,
  pruneStalePushDueItems,
  todoReminderDates,
};
