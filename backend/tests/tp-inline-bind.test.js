const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

function loadBinder() {
  const htmlStore = new WeakMap();
  class FakeEl {
    constructor() {
      this.nodeType = 1;
      this.attributes = [];
      this.style = { cssText: '' };
    }
    getAttribute() { return null; }
    setAttribute() {}
    removeAttribute() {}
    querySelectorAll() { return []; }
    addEventListener() {}
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
    },
    Element: { prototype: FakeEl.prototype },
    Object,
    Array,
    String,
    Number,
    Boolean,
    eval,
    Function,
    setTimeout,
    setInterval,
    console,
  };
  ctx.window = ctx;
  ctx.global = ctx;
  ctx.document.documentElement.nodeType = 1;
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, '..', '..', 'tp-inline-bind.js'), 'utf8'),
    ctx
  );
  return ctx;
}

test('inline parser rejects eval and _tpSafeCall gadgets', () => {
  const ctx = loadBinder();
  assert.equal(ctx._tpParseInline("eval('stolen')"), null);
  assert.equal(ctx._tpParseInline("Function('stolen')"), null);
  assert.equal(ctx._tpParseInline("fetch('https://evil.example')"), null);
  assert.equal(ctx._tpParseInline("_tpSafeCall('eval','stolen')"), null);
  assert.ok(ctx._tpParseInline('openStudentDetail(1)'));
  assert.ok(ctx._tpParseInline("saveTopic(3, 'علی')"));
});

test('_tpSafeCall cannot reach eval or Function', () => {
  const ctx = loadBinder();
  let ran = false;
  ctx.eval = function () { ran = true; return 'stolen'; };
  ctx.Function = function () { ran = true; };
  assert.equal(ctx._tpSafeCall('eval', '1+1'), undefined);
  assert.equal(ctx._tpSafeCall('Function', 'return 1'), undefined);
  assert.equal(ctx._tpSafeCall('setTimeout', 'stolen', 0), undefined);
  assert.equal(ran, false);
  ctx.okFn = function (x) { return x; };
  assert.equal(ctx._tpSafeCall('okFn', 7), 7);
});

test('inline parser keeps habit card toggle handlers', () => {
  const ctx = loadBinder();
  assert.ok(ctx._tpParseInline('_onHabitCardClick(event, 12)'));
  assert.ok(ctx._tpParseInline('event.stopPropagation();toggleHabitToday(12)'));
});

test('inline parser rejects live identifiers like _instrParentId', () => {
  const ctx = loadBinder();
  assert.equal(ctx._tpParseInline("openAddInstruction(_instrParentId,'category')"), null);
  assert.ok(ctx._tpParseInline("openAddInstruction(42,'category')"));
  assert.ok(ctx._tpParseInline("openAddInstruction(null,'note')"));
});

test('inline CSS sanitizer strips scripted urls', () => {
  const ctx = loadBinder();
  assert.equal(ctx._tpSanitizeCss('color:red;background:url(javascript:alert(1))'), '');
  assert.equal(ctx._tpSanitizeCss('background:url(https://evil.example/x)'), 'background:none');
  assert.match(ctx._tpSanitizeCss('color:var(--accent);background:var(--bg2)'), /color:var\(--accent\)/);
});
