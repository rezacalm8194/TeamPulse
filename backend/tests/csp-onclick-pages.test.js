const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const FILES = ['app.html', 'app.js', 'app-extra.js', 'app-finance.js', 'app-sessions.js', 'app-todos.js'];

function loadBinder() {
  const htmlStore = new WeakMap();
  class FakeEl {
    constructor() {
      this.nodeType = 1;
      this.tagName = 'DIV';
      this.attributes = [];
      this.style = { cssText: '', background: '', color: '', outline: '', borderColor: '' };
      this.listeners = Object.create(null);
      this.classList = {
        _n: Object.create(null),
        toggle(name, force) {
          if (force === undefined) {
            if (this._n[name]) delete this._n[name];
            else this._n[name] = 1;
          } else if (force) this._n[name] = 1;
          else delete this._n[name];
        },
        contains(name) { return !!this._n[name]; },
      };
    }
    getAttribute() { return null; }
    setAttribute() {}
    removeAttribute(name) {
      this.attributes = this.attributes.filter((a) => a.name !== name);
    }
    querySelectorAll() { return []; }
    addEventListener(type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    }
    click() {
      const ev = { target: this, type: 'click', stopPropagation() {}, preventDefault() {} };
      for (const fn of this.listeners.click || []) fn.call(this, ev);
    }
    closest(sel) { return sel ? this : null; }
    remove() { this.removed = true; }
  }
  Object.defineProperty(FakeEl.prototype, 'innerHTML', {
    configurable: true,
    enumerable: true,
    get() { return htmlStore.get(this) || ''; },
    set(v) { htmlStore.set(this, String(v == null ? '' : v)); },
  });
  Object.defineProperty(FakeEl.prototype, 'outerHTML', {
    configurable: true,
    enumerable: true,
    get() { return htmlStore.get(this) || ''; },
    set(v) { htmlStore.set(this, String(v == null ? '' : v)); },
  });
  const ctx = {
    window: null,
    addEventListener() {},
    document: {
      readyState: 'complete',
      addEventListener() {},
      documentElement: new FakeEl(),
      querySelectorAll() { return []; },
      getElementById() { return null; },
    },
    Element: { prototype: FakeEl.prototype },
    Object, Array, String, Number, Boolean, eval, Function, setTimeout, setInterval, console,
    location: { reload() {} },
    print() {},
  };
  ctx.window = ctx;
  ctx.global = ctx;
  ctx.document.documentElement.nodeType = 1;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'tp-inline-bind.js'), 'utf8'), ctx);
  ctx.FakeEl = FakeEl;
  return ctx;
}

function normalizeHandler(code) {
  return String(code)
    .replace(/\$\{[^}]+\}/g, '1')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

function extractHandlers(src) {
  const out = [];
  const attrRe = /\bon([a-z]+)\s*=\s*(['"])([\s\S]*?)\2/gi;
  let m;
  while ((m = attrRe.exec(src))) out.push({ ev: m[1], code: normalizeHandler(m[3]) });
  const actionRe = /\baction:\s*(['"`])([\s\S]*?)\1/g;
  while ((m = actionRe.exec(src))) out.push({ ev: 'click', code: normalizeHandler(m[2]) });
  return out;
}

function looksLikeRuntimeJs(code) {
  if (!/[A-Za-z_$]\w*\s*\(/.test(code) && !/^this\.|^event\.|^window\.print|^if\(/.test(code)) return true;
  if (/\$\{/.test(code)) return true;
  if (/\+\s*['"`]|['"`]\s*\+|===\s*'staff'|item\.kind/.test(code)) return true;
  if (/\w+\(\s*$/.test(code)) return true;
  if (/;\s*(?:1|true|false|null)\s*$/.test(code)) return true;
  const opens = (code.match(/\(/g) || []).length;
  const closes = (code.match(/\)/g) || []).length;
  if (opens !== closes) return true;
  return false;
}

test('app.html shell handlers all parse under the CSP binder', () => {
  const ctx = loadBinder();
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.doesNotMatch(html, /script-src [^;]*'unsafe-inline'/);
  const handlers = extractHandlers(html).filter((h) => h.code.trim());
  assert.ok(handlers.length >= 20, 'expected shell on* handlers');
  const fails = handlers.filter((h) => !ctx._tpParseInline(h.code));
  assert.deepEqual(fails, [], fails.map((f) => f.code).join('\n'));
});

test('generated page handlers that survive ${} substitution still parse', () => {
  const ctx = loadBinder();
  const fails = [];
  for (const file of FILES) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const h of extractHandlers(src)) {
      const code = h.code.trim();
      if (!code || looksLikeRuntimeJs(code)) continue;
      if (!ctx._tpParseInline(code)) fails.push(`${file} ${h.ev} ${code.slice(0, 180)}`);
    }
  }
  assert.deepEqual(fails, [], fails.join('\n'));
});

test('binder click-dispatches representative controls from every nav page', () => {
  const ctx = loadBinder();
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  const pages = [...html.matchAll(/\bdata-page="([^"]+)"/g)].map((m) => m[1]);
  const uniqPages = [...new Set(pages)];
  assert.ok(uniqPages.includes('home') && uniqPages.includes('payments') && uniqPages.includes('tutorial'));

  const byPage = {
    home: ['bnNav(this)', '_homeToggleHabit(3)', '_homeToggleTodo(4)'],
    goals: ['_tpGo("goals")', 'openAddGoal()'],
    habits: ['_onHabitCardClick(event, 12)', 'event.stopPropagation();toggleHabitToday(12)', '_tpHabitFilter("all")'],
    todolist: ['openAddTodo()', '_setTodoTab("mine")'],
    calendar: ['_tpOpenCalendarCreate("task")', 'event.stopPropagation()'],
    instructions: ["openAddInstruction(null,'kcategory')", "_tpInstrFilter('all')", "_instrOpenTransferModal([9],'move')"],
    students: ['openStudentDetail(1)', 'toggleRowMenu(event,"m1")'],
    sessions: ['openSessionDetail(2)', "_openAttachment(decodeURIComponent('a'),decodeURIComponent('b'),decodeURIComponent('c'))"],
    families: ['openNewFamily()', 'this.classList.toggle("checked")'],
    payments: ["_tpPaymentsTab('purchases')", "openBalePaymentRequest({student_id:1,reminder_id:2,package_id:null,amount:3,title:'x'})"],
    staff: ['openStaffDetail(1)', 'window.print()'],
    dashboard: ['openExpenseManager()', 'toggleTopEarners(this)'],
    transactions: ['openFiscalYearClosing()'],
    reminders: ['openAddReminder()', 'markReminderPaid(1)'],
    settings: ["switchSettingsTab('backup')"],
    tutorial: ['_tpToggleTut(this)'],
    admin_panel: ["_adminChangePlan(['u1'])", '_adminChangePlanSelected()', '_adminToggleStatus(this.dataset.uid,+this.dataset.status)'],
  };

  for (const page of uniqPages) {
    const samples = byPage[page] || [];
    assert.ok(samples.length, `missing click fixtures for page ${page}`);
  }
  byPage.shell = [
    'closeSidebar()', 'toggleSidebar()', '_togglePlanGroup(event)', '_tpWalletNav()',
    '_tpOpenAdminPanel()', '_tpAuthThenBackup()', '_tpSignOut()',
    "if(event.target===this)closeNewItemSheet()",
    'closeNewItemSheet();openAddTodo()',
  ];

  const called = [];
  for (const [page, samples] of Object.entries(byPage)) {
    for (const code of samples) {
      assert.ok(ctx._tpParseInline(code), `${page}: ${code}`);
      const el = new ctx.FakeEl();
      el.dataset = { uid: 'u1', status: '0' };
      el.attributes = [{ name: 'onclick', value: code }];
      const name = code.match(/^([A-Za-z_][\w]*)\(/);
      if (name && !ctx._tpInlineDeny[name[1]]) {
        ctx[name[1]] = function () { called.push(page + ':' + name[1]); };
      }
      ctx._tpBindInline(el);
      assert.equal(el.attributes.some((a) => a.name === 'onclick'), false, `onclick left on ${code}`);
      el.click();
    }
  }
  assert.ok(called.length > 20, `expected bound clicks to run, got ${called.length}`);
});

test('expanded syntax still rejects eval gadgets', () => {
  const ctx = loadBinder();
  assert.equal(ctx._tpParseInline("foo(eval('1'))"), null);
  assert.equal(ctx._tpParseInline('foo(Function("return 1"))'), null);
  assert.equal(ctx._tpParseInline('foo({__proto__: 1})'), null);
  assert.equal(ctx._tpParseInline("this.classList.toggle('x;alert(1)')"), null);
  assert.equal(ctx._tpParseInline("this.style.background='expression(alert(1))'"), null);
  assert.equal(ctx._tpParseInline("this.closest('a').href='javascript:alert(1)'"), null);
  assert.ok(ctx._tpParseInline("openAllTopics(1, decodeURIComponent('Ali'))"));
  assert.ok(ctx._tpParseInline('openEditTopic(+this.dataset.tid,+this.dataset.sid,this.dataset.dname)'));
  assert.ok(ctx._tpParseInline("this.style.background='var(--bg3)';this.style.color='var(--text)'"));
  assert.ok(ctx._tpParseInline("this.closest('.case-form-builder-row').remove()"));
});
