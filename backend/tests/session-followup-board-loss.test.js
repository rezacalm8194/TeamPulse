const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');

function functionSource(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `${name} must exist`);
  const open = source.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(name);
}

function load(name, context) {
  const sandbox = vm.createContext(context);
  return vm.runInContext(`${functionSource(name)}\n${name}`, sandbox);
}

function loadMany(names, context) {
  const sandbox = vm.createContext(context);
  for (const name of names) vm.runInContext(functionSource(name), sandbox);
  return sandbox;
}

test('session followup due date creates one session_followup reminder and marks it done', () => {
  let nextId = 1;
  const db = {
    students: [{ id: 1, name: 'مینا', lname: 'رضایی' }],
    sessions: [],
    reminders: [],
  };
  const ctx = loadMany(
    ['_normalizeSessionFollowup', '_sessionFollowupOverdue', '_markSessionFollowupReminderDone', '_syncSessionFollowupReminder'],
    {
      _db: db,
      Date,
      _daysUntil: () => -1,
      _nextId: () => nextId++,
    }
  );

  const session = { id: 10, student_id: 1, followups: [] };
  const followup = ctx._normalizeSessionFollowup({ text: 'تماس فردا', due_date_jalali: '1405/01/01' });
  session.followups.push(followup);
  ctx._syncSessionFollowupReminder(session, followup);
  ctx._syncSessionFollowupReminder(session, followup);

  assert.equal(db.reminders.length, 1);
  assert.equal(db.reminders[0].source, 'session_followup');
  assert.equal(db.reminders[0].due_date_jalali, '1405/01/01');
  assert.equal(followup.reminder_id, db.reminders[0].id);
  assert.match(db.reminders[0].title, /تماس فردا/);

  followup.done = true;
  ctx._syncSessionFollowupReminder(session, followup);
  assert.equal(db.reminders[0].done, true);
});

test('sessions board filter matches open, overdue, no month and key columns', () => {
  const match = load('sessionGroupMatchesBoardFilter', {
    _todayJalali: () => [1405, 6, 15],
    _jalaliParse: str => String(str || '').split('/').map(Number),
    _sessionFollowupOverdue: f => !f.done && f.due_date_jalali === 'past',
  });

  const open = { sessions: [{ followups: [{ done: false, due_date_jalali: '' }], date_jalali: '1405/05/01', importance: 'normal' }] };
  const overdue = { sessions: [{ followups: [{ done: false, due_date_jalali: 'past' }], date_jalali: '1405/05/01', importance: 'normal' }] };
  const thisMonth = { sessions: [{ followups: [], date_jalali: '1405/06/01', importance: 'normal' }] };
  const key = { sessions: [{ followups: [], date_jalali: '1405/05/01', importance: 'key' }] };

  assert.equal(match(open, 'open'), true);
  assert.equal(match(thisMonth, 'open'), false);
  assert.equal(match(overdue, 'overdue'), true);
  assert.equal(match(open, 'overdue'), false);
  assert.equal(match(open, 'no_month'), true);
  assert.equal(match(thisMonth, 'no_month'), false);
  assert.equal(match(key, 'key'), true);
  assert.equal(match(open, 'key'), false);
  assert.equal(match(open, 'all'), true);
});

test('archive status ناموفق without reason opens modal; with reason persists loss_reason', async () => {
  const student = { id: 7, archived: true, relationship_status: 'جلسه', loss_reason: '' };
  let modalOpened = false;
  const calls = [];
  const changeArchiveStage = load('changeArchiveStage', {
    archiveStudents: [student],
    archiveStatusOptions: ['جلسه', 'ناموفق'],
    openArchiveLossReasonModal: () => { modalOpened = true; },
    window: { api: { students: { bulkArchiveAction: async payload => {
      calls.push(payload);
      student.relationship_status = payload.value;
      if (payload.loss_reason !== undefined) student.loss_reason = payload.loss_reason;
    } } } },
    renderArchive: async () => {},
  });

  await changeArchiveStage(7, 'ناموفق');
  assert.equal(modalOpened, true);
  assert.equal(calls.length, 0);
  assert.equal(student.relationship_status, 'جلسه');

  student.loss_reason = 'قیمت';
  await changeArchiveStage(7, 'ناموفق');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'status');
  assert.equal(calls[0].value, 'ناموفق');
  assert.equal(calls[0].loss_reason, 'قیمت');
  assert.deepEqual([...calls[0].ids], [7]);
  assert.equal(student.loss_reason, 'قیمت');
});

test('asset versions stay aligned after session/archive follow-up features', () => {
  const version = source.match(/const TP_ASSET_V = 'tp(\d+)'/)[1];
  assert.ok(version);
  assert.ok(source.includes(`/sw.js?v=team-pulse-static-v${version}`));
  const worker = fs.readFileSync(path.resolve(__dirname, '../../sw.js'), 'utf8');
  assert.ok(worker.includes(`team-pulse-static-v${version}`));
  const html = fs.readFileSync(path.resolve(__dirname, '../../app.html'), 'utf8');
  for (const match of html.matchAll(/\?v=tp(\d+)/g)) assert.equal(match[1], version);
  assert.match(source, /loss_reason/);
  assert.match(source, /session_followup/);
  assert.match(source, /tp_sessions_board_filter/);
});
