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

function loadMany(names, context) {
  const sandbox = vm.createContext(context);
  for (const name of names) vm.runInContext(functionSource(name), sandbox);
  return sandbox;
}

test('sessions summary copy and html include followups and achievements', () => {
  const ctx = loadMany(
    [
      '_sessionsSummaryFollowups',
      '_sessionsSummaryFollowupCopy',
      '_sessionsSummaryFollowupHtml',
      '_sessionsSummaryAchievementsCopy',
      '_sessionsSummaryAchievementsHtml',
    ],
    {
      DateService: { disp: d => d },
      escapeHtml: s => String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;'),
      renderRich: s => `RICH:${s}`,
      _achievementPeriodBadge: () => '<span class="badge">دوره</span>',
    }
  );

  const session = {
    followups: [
      { text: ' تماس با مربی ', done: false, due_date_jalali: '1405/01/02' },
      { text: 'تمرین تنفس', done: true },
      { text: '   ' },
    ],
    achievements: 'اعتمادبه‌نفس بالاتر رفته',
  };

  const copyFu = ctx._sessionsSummaryFollowupCopy(session);
  assert.match(copyFu, /اقدامات تا جلسه بعد/);
  assert.match(copyFu, /تماس با مربی/);
  assert.match(copyFu, /موعد: 1405\/01\/02/);
  assert.match(copyFu, /انجام شد — تمرین تنفس/);
  assert.doesNotMatch(copyFu, /-\s*$/m);

  const htmlFu = ctx._sessionsSummaryFollowupHtml(session);
  assert.match(htmlFu, /اقدامات تا جلسه بعد/);
  assert.match(htmlFu, /تماس با مربی/);
  assert.match(htmlFu, /summary-fu-item done/);
  assert.match(htmlFu, /تمرین تنفس/);

  assert.equal(ctx._sessionsSummaryFollowupCopy({ followups: [] }), '');
  assert.equal(ctx._sessionsSummaryFollowupHtml({}), '');

  const copyAch = ctx._sessionsSummaryAchievementsCopy(session);
  assert.equal(copyAch, 'پیشرفت‌ها:\nاعتمادبه‌نفس بالاتر رفته');
  const htmlAch = ctx._sessionsSummaryAchievementsHtml(session);
  assert.match(htmlAch, /پیشرفت‌ها/);
  assert.match(htmlAch, /RICH:اعتمادبه‌نفس بالاتر رفته/);
  assert.match(htmlAch, /دوره/);
  assert.equal(ctx._sessionsSummaryAchievementsCopy({}), '');
  assert.equal(ctx._sessionsSummaryAchievementsHtml({ achievements: '  ' }), '');
});
