const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');

function functionSource(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `${name} must exist in app.js`);
  const open = source.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(`Could not read ${name}`);
}

function loadFunction(name, context) {
  const sandbox = vm.createContext(context);
  return vm.runInContext(`${functionSource(name)}\n${name}`, sandbox);
}

test('archive stale rules exclude terminal stages and respect activity age and future work', () => {
  const isArchiveStale = loadFunction('isArchiveStale', {
    _db: { meta: { archive_stale_days: 14 } },
    Date,
    _daysUntil: value => value === 'future' ? 2 : -2,
  });
  const now = Date.parse('2026-09-06T12:00:00Z');
  const old = '2026-08-01T12:00:00Z';

  assert.equal(isArchiveStale({ archived: true, relationship_status: 'ناموفق', last_activity_at: old }, now), false);
  assert.equal(isArchiveStale({ archived: true, relationship_status: 'مشتری شد', last_activity_at: old }, now), false);
  assert.equal(isArchiveStale({ archived: true, relationship_status: 'جلسه', last_activity_at: old }, now), true);
  assert.equal(isArchiveStale({ archived: true, relationship_status: 'جلسه', last_activity_at: old, next_activity_date: 'past' }, now), true);
  assert.equal(isArchiveStale({ archived: true, relationship_status: 'جلسه', last_activity_at: old, next_activity_date: 'future' }, now), false);
});

test('pipeline stage selection changes relationship status without converting the archive row', async () => {
  const student = { id: 7, archived: true, relationship_status: 'تماس نگرفته' };
  const calls = [];
  const changeArchiveStage = loadFunction('changeArchiveStage', {
    archiveStudents: [student],
    archiveStatusOptions: ['تماس نگرفته', 'جلسه'],
    window: { api: { students: { bulkArchiveAction: async payload => {
      calls.push(payload);
      student.relationship_status = payload.value;
    } } } },
    renderArchive: async () => {},
  });

  await changeArchiveStage(7, 'جلسه');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ ids: [7], action: 'status', value: 'جلسه' }]);
  assert.equal(student.relationship_status, 'جلسه');
  assert.equal(student.archived, true);
});

test('archive follow-up opens the activity form and persists one reusable sourced reminder', async () => {
  const student = { id: 9, name: 'مینا', lname: 'رضایی', archived: true, relationship_status: '' };
  const reminders = [];
  let modalOpened = false;
  const markArchiveFollowup = loadFunction('markArchiveFollowup', {
    archiveStudents: [student],
    archiveActivityFields: () => '<form>activity</form>',
    openModal: (_title, html) => { modalOpened = html.includes('activity'); },
    initDatePickers: () => {},
  });
  markArchiveFollowup(9);
  assert.equal(modalOpened, true);

  const persistArchiveActivity = loadFunction('persistArchiveActivity', {
    _db: { students: [student], reminders },
    Date,
    _save: () => {},
    window: { api: { reminders: {
      add: async payload => reminders.push({ id: 1, ...payload, due_date_jalali: payload.due_date }),
      update: async ({ id, patch }) => Object.assign(reminders.find(r => r.id === id), patch),
    } } },
  });
  const first = { next_activity_type: 'call', next_activity_date: '1405/06/20', next_activity_note: 'تماس اول' };
  const second = { next_activity_type: 'meeting', next_activity_date: '1405/06/22', next_activity_note: 'زمان جدید' };

  await persistArchiveActivity(9, first);
  await persistArchiveActivity(9, second);

  assert.equal(student.relationship_status, 'نیازمند پیگیری');
  assert.equal(student.next_activity_type, 'meeting');
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].source, 'archive_followup');
  assert.equal(reminders[0].due_date_jalali, '1405/06/22');
  assert.match(reminders[0].title, /جلسه/);
});
