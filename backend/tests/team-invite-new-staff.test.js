const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');

function extractFn(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = app.indexOf('\nfunction ', start + 1);
  return app.slice(start, end);
}

function loadHelpers() {
  const context = {
    _db: { staff: [], staff_roles: [{ id: 1 }], _nextId: { staff: 10 } },
    staffIsPersonnel(s) { return (s?.person_type || 'personnel') === 'personnel'; },
    _nextId() { return 10; },
  };
  vm.createContext(context);
  vm.runInContext(
    [
      extractFn('_teamStaffInviteEmail'),
      extractFn('_teamStaffNameFromEmail'),
      extractFn('_teamFindStaffByEmail'),
      extractFn('_teamEnsureStaffForInvite'),
    ].join('\n'),
    context
  );
  return context;
}

test('invite form no longer blocks a new teammate without a staff pick', () => {
  assert.doesNotMatch(app, /یک رکورد پرسنل را برای این دعوت انتخاب کن/);
  assert.match(app, /function _teamEnsureStaffForInvite\(/);
  assert.match(app, /— پرسنل جدید —/);
});

test('invite without a staff pick creates a personnel row from email', () => {
  const ctx = loadHelpers();
  const staff = ctx._teamEnsureStaffForInvite('sara@example.com', '', 'سارا');
  assert.equal(staff.id, 10);
  assert.equal(staff.email, 'sara@example.com');
  assert.equal(staff.name, 'سارا');
  assert.equal(staff.person_type, 'personnel');
  assert.equal(ctx._db.staff.length, 1);
});

test('invite reuses the existing staff row with the same email', () => {
  const ctx = loadHelpers();
  ctx._db.staff.push({ id: 4, name: 'سارا', email: 'sara@example.com', person_type: 'personnel' });
  const staff = ctx._teamEnsureStaffForInvite('sara@example.com', '', '');
  assert.equal(staff.id, 4);
  assert.equal(ctx._db.staff.length, 1);
});
