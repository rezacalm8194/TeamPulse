(function () {
  function tpExtNoise(m) {
    m = String(m || '');
    return m.indexOf('Could not establish connection') >= 0 ||
      m.indexOf('Receiving end does not exist') >= 0 ||
      m.indexOf('Extension context invalidated') >= 0;
  }
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason || {};
    var m = (r && r.message) || String(r || '');
    if (tpExtNoise(m)) e.preventDefault();
  }, true);
  window.addEventListener('error', function (e) {
    if (tpExtNoise(e && e.message)) e.preventDefault();
  }, true);
})();

/**
 * CSP-safe binding of HTML on* attributes.
 * Inline handlers are blocked without script-src unsafe-inline.
 * This rebinds only global function calls with literal / this / event args.
 */
(function (global) {
  'use strict';
  var DENY = {
    eval: 1, Function: 1, fetch: 1, setTimeout: 1, setInterval: 1,
    alert: 1, confirm: 1, prompt: 1, open: 1, close: 1, print: 1,
    XMLHttpRequest: 1, WebSocket: 1, Worker: 1, SharedWorker: 1,
    importScripts: 1, postMessage: 1, queueMicrotask: 1, atob: 1, btoa: 1,
    setImmediate: 1, execScript: 1, location: 1, document: 1,
    navigator: 1, localStorage: 1, sessionStorage: 1, indexedDB: 1,
    history: 1, parent: 1, top: 1, frames: 1, self: 1, window: 1, globalThis: 1,
    Image: 1, Audio: 1, Blob: 1, File: 1, FileReader: 1, EventSource: 1,
    Request: 1, Response: 1, Headers: 1, AbortController: 1,
    import: 1, require: 1, process: 1, sendBeacon: 1, openDatabase: 1,
    showModalDialog: 1, _tpSafeCall: 1
  };
  var FRAME_OK = /^https:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com|translate\.google\.com)\//i;
  var ON_RE = /^on[a-z]+$/i;

  function skipWs(s, i) {
    while (i < s.length && /\s/.test(s.charAt(i))) i++;
    return i;
  }

  function parseString(s, i) {
    var q = s.charAt(i);
    if (q !== "'" && q !== '"') return null;
    i++;
    var out = '';
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === '\\') {
        out += s.charAt(i + 1) || '';
        i += 2;
        continue;
      }
      if (c === q) return { value: out, i: i + 1 };
      out += c;
      i++;
    }
    return null;
  }

  var BAD_OBJ_KEY = /^(?:__proto__|prototype|constructor)$/;
  var CSS_PROP_OK = /^[a-zA-Z][a-zA-Z0-9]*$/;
  var CSS_VAL_OK = /^(?:|none|transparent|(?:\d+px\s+solid\s+)?var\(--[\w-]+\)|var\(--[\w-]+\)\d+|#[0-9a-fA-F]{3,8}|[a-zA-Z][\w-]*)$/;
  var CLASS_OK = /^[a-zA-Z][\w-]*$/;
  var SEL_OK = /^[#.]?[A-Za-z][\w-]*(?:\[[\w-]+(?:=['"]?[\w#-]+['"]?)?\])?$/;

  function parseExpr(s, i) {
    i = skipWs(s, i);
    if (i >= s.length) return null;
    var ch = s.charAt(i);
    if (ch === '+' || ch === '-') {
      if (ch === '-' && /\d/.test(s.charAt(i + 1) || '')) {
        /* fall through to numeric literal */
      } else {
        var innerU = parseExpr(s, i + 1);
        if (!innerU) return null;
        return { kind: 'unary', op: ch, expr: innerU, i: innerU.i };
      }
    }
    if (ch === '[') return parseArray(s, i);
    if (ch === '{') return parseObject(s, i);
    if (s.slice(i, i + 9) === 'undefined' && !/\w/.test(s.charAt(i + 9) || '')) {
      return { kind: 'lit', value: undefined, i: i + 9 };
    }
    if (s.slice(i, i + 4) === 'true' && !/\w/.test(s.charAt(i + 4) || '')) {
      return { kind: 'lit', value: true, i: i + 4 };
    }
    if (s.slice(i, i + 5) === 'false' && !/\w/.test(s.charAt(i + 5) || '')) {
      return { kind: 'lit', value: false, i: i + 5 };
    }
    if (s.slice(i, i + 4) === 'null' && !/\w/.test(s.charAt(i + 4) || '')) {
      return { kind: 'lit', value: null, i: i + 4 };
    }
    var num = /^-?\d+(?:\.\d+)?/.exec(s.slice(i));
    if (num) return { kind: 'lit', value: Number(num[0]), i: i + num[0].length };
    var str = parseString(s, i);
    if (str) return { kind: 'lit', value: str.value, i: str.i };

    if (s.slice(i, i + 5) === 'event' && !/[A-Za-z0-9_$]/.test(s.charAt(i + 5) || '')) {
      i += 5;
      var epath = [];
      while (s.charAt(i) === '.') {
        i++;
        var em = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
        if (!em) return null;
        epath.push(em[0]);
        i += em[0].length;
      }
      if (s.charAt(i) === '(') return null;
      return { kind: 'event', path: epath, i: i };
    }
    if (s.slice(i, i + 4) === 'this' && !/[A-Za-z0-9_$]/.test(s.charAt(i + 4) || '')) {
      i += 4;
      var tpath = [];
      while (s.charAt(i) === '.') {
        i++;
        var tm = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
        if (!tm) return null;
        tpath.push(tm[0]);
        i += tm[0].length;
      }
      if (s.charAt(i) === '(') return null;
      return { kind: 'this', path: tpath, i: i };
    }
    var nested = parseCall(s, i);
    if (nested && nested.kind === 'call') {
      return { kind: 'ncall', name: nested.name, args: nested.args, i: nested.i };
    }
    return null;
  }

  function parseArray(s, i) {
    if (s.charAt(i) !== '[') return null;
    i = skipWs(s, i + 1);
    var items = [];
    if (s.charAt(i) !== ']') {
      while (true) {
        var item = parseExpr(s, i);
        if (!item) return null;
        items.push(item);
        i = skipWs(s, item.i);
        if (s.charAt(i) === ',') { i = skipWs(s, i + 1); continue; }
        break;
      }
    }
    if (s.charAt(i) !== ']') return null;
    return { kind: 'arr', items: items, i: i + 1 };
  }

  function parseObject(s, i) {
    if (s.charAt(i) !== '{') return null;
    i = skipWs(s, i + 1);
    var pairs = [];
    if (s.charAt(i) !== '}') {
      while (true) {
        var km = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
        if (!km || BAD_OBJ_KEY.test(km[0])) return null;
        i = skipWs(s, i + km[0].length);
        if (s.charAt(i) !== ':') return null;
        var val = parseExpr(s, i + 1);
        if (!val) return null;
        pairs.push({ k: km[0], v: val });
        i = skipWs(s, val.i);
        if (s.charAt(i) === ',') { i = skipWs(s, i + 1); continue; }
        break;
      }
    }
    if (s.charAt(i) !== '}') return null;
    return { kind: 'obj', pairs: pairs, i: i + 1 };
  }

  function parseThisStyleAssign(s, i) {
    if (s.slice(i, i + 11) !== 'this.style.') return null;
    i += 11;
    var pm = /^[A-Za-z][a-zA-Z0-9]*/.exec(s.slice(i));
    if (!pm || !CSS_PROP_OK.test(pm[0]) || pm[0] === 'cssText') return null;
    i = skipWs(s, i + pm[0].length);
    if (s.charAt(i) !== '=') return null;
    var val = parseExpr(s, i + 1);
    if (!val || val.kind !== 'lit' || typeof val.value !== 'string' || !CSS_VAL_OK.test(val.value)) return null;
    return { kind: 'style', prop: pm[0], value: val.value, i: val.i };
  }

  function parseClassToggle(s, i) {
    if (s.slice(i, i + 22) !== 'this.classList.toggle(') return null;
    i = skipWs(s, i + 22);
    var cls = parseString(s, i);
    if (!cls || !CLASS_OK.test(cls.value)) return null;
    i = skipWs(s, cls.i);
    var force = null;
    if (s.charAt(i) === ',') {
      force = parseExpr(s, i + 1);
      if (!force) return null;
      i = skipWs(s, force.i);
    }
    if (s.charAt(i) !== ')') return null;
    return { kind: 'clstog', cls: cls.value, force: force, i: i + 1 };
  }

  function parseClosestRemove(s, i) {
    if (s.slice(i, i + 13) !== 'this.closest(') return null;
    i = skipWs(s, i + 13);
    var sel = parseString(s, i);
    if (!sel || !SEL_OK.test(sel.value)) return null;
    i = skipWs(s, sel.i);
    if (s.charAt(i) !== ')') return null;
    i = skipWs(s, i + 1);
    if (s.slice(i, i + 8) !== '.remove(') return null;
    i = skipWs(s, i + 8);
    if (s.charAt(i) !== ')') return null;
    return { kind: 'closestRm', sel: sel.value, i: i + 1 };
  }

  function parseParentRemove(s, i) {
    var which = null;
    if (s.slice(i, i + 16) === 'this.parentNode.') which = 'parentNode';
    else if (s.slice(i, i + 19) === 'this.parentElement.') which = 'parentElement';
    if (!which) return null;
    i += which === 'parentNode' ? 16 : 19;
    if (s.slice(i, i + 7) !== 'remove(') return null;
    i = skipWs(s, i + 7);
    if (s.charAt(i) !== ')') return null;
    return { kind: 'parentRm', which: which, i: i + 1 };
  }

  function parseCall(s, i) {
    i = skipWs(s, i);
    if (s.slice(i, i + 21) === 'event.stopPropagation' && s.charAt(i + 21) === '(') {
      i = skipWs(s, i + 22);
      if (s.charAt(i) !== ')') return null;
      return { kind: 'stop', i: i + 1 };
    }
    if (s.slice(i, i + 20) === 'event.preventDefault' && s.charAt(i + 20) === '(') {
      i = skipWs(s, i + 21);
      if (s.charAt(i) !== ')') return null;
      return { kind: 'prevent', i: i + 1 };
    }
    if (s.slice(i, i + 15) === 'location.reload' && s.charAt(i + 15) === '(') {
      i = skipWs(s, i + 16);
      if (s.charAt(i) !== ')') return null;
      return { kind: 'reload', i: i + 1 };
    }
    if (s.slice(i, i + 12) === 'window.print' && s.charAt(i + 12) === '(') {
      i = skipWs(s, i + 13);
      if (s.charAt(i) !== ')') return null;
      return { kind: 'print', i: i + 1 };
    }
    var styled = parseThisStyleAssign(s, i);
    if (styled) return styled;
    var tog = parseClassToggle(s, i);
    if (tog) return tog;
    var crm = parseClosestRemove(s, i);
    if (crm) return crm;
    var prm = parseParentRemove(s, i);
    if (prm) return prm;
    var id = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
    if (!id) return null;
    var name = id[0];
    i = skipWs(s, i + name.length);
    if (s.charAt(i) !== '(') return null;
    i++;
    var args = [];
    i = skipWs(s, i);
    if (s.charAt(i) !== ')') {
      while (true) {
        var expr = parseExpr(s, i);
        if (!expr) return null;
        args.push(expr);
        i = skipWs(s, expr.i);
        if (s.charAt(i) === ',') {
          i++;
          continue;
        }
        break;
      }
    }
    if (s.charAt(i) !== ')') return null;
    if (DENY[name] || name.indexOf('_tpUnsafe') === 0) return null;
    return { kind: 'call', name: name, args: args, i: i + 1 };
  }

  function parseIfSelfCall(s, i) {
    i = skipWs(s, i);
    if (s.slice(i, i + 2) !== 'if') return null;
    i = skipWs(s, i + 2);
    if (s.charAt(i) !== '(') return null;
    i = skipWs(s, i + 1);
    var condOk = false;
    if (s.slice(i, i + 19) === 'event.target===this') { condOk = true; i += 19; }
    else if (s.slice(i, i + 21) === 'event.target === this') { condOk = true; i += 21; }
    else if (s.slice(i, i + 18) === 'event.target==this') { condOk = true; i += 18; }
    if (!condOk) return null;
    i = skipWs(s, i);
    if (s.charAt(i) !== ')') return null;
    i = skipWs(s, i + 1);
    var call = parseCall(s, i);
    if (!call || call.kind !== 'call') return null;
    call.kind = 'ifs';
    return call;
  }

  function parseProgram(code) {
    var s = String(code || '').replace(/^\s+|\s+$/g, '').replace(/;+\s*$/, '');
    if (!s) return null;
    var stmts = [];
    var i = 0;
    while (i < s.length) {
      i = skipWs(s, i);
      if (i >= s.length) break;
      if (s.slice(i, i + 12) === 'return false') {
        stmts.push({ kind: 'retfalse' });
        i += 12;
      } else {
        var st = parseIfSelfCall(s, i) || parseCall(s, i);
        if (!st) return null;
        stmts.push(st);
        i = st.i;
      }
      i = skipWs(s, i);
      if (s.charAt(i) === ';') i++;
      else if (i < s.length) return null;
    }
    return stmts.length ? stmts : null;
  }

  function readPath(root, path) {
    var cur = root;
    for (var n = 0; n < path.length; n++) {
      if (cur == null) return undefined;
      var key = path[n];
      if (key === 'innerHTML' || key === 'outerHTML' || key === 'cookie' || key === 'srcdoc') return undefined;
      cur = cur[key];
    }
    return cur;
  }

  function evalExpr(expr, el, event) {
    if (!expr) return undefined;
    if (expr.kind === 'lit') return expr.value;
    if (expr.kind === 'this') return expr.path.length ? readPath(el, expr.path) : el;
    if (expr.kind === 'event') return expr.path.length ? readPath(event, expr.path) : event;
    if (expr.kind === 'unary') {
      var uv = Number(evalExpr(expr.expr, el, event));
      return expr.op === '-' ? -uv : uv;
    }
    if (expr.kind === 'arr') {
      var arr = [];
      for (var ai = 0; ai < expr.items.length; ai++) arr.push(evalExpr(expr.items[ai], el, event));
      return arr;
    }
    if (expr.kind === 'obj') {
      var obj = Object.create(null);
      for (var pi = 0; pi < expr.pairs.length; pi++) obj[expr.pairs[pi].k] = evalExpr(expr.pairs[pi].v, el, event);
      return obj;
    }
    if (expr.kind === 'ncall') {
      if (DENY[expr.name]) return undefined;
      var nfn = global[expr.name];
      if (typeof nfn !== 'function') return undefined;
      if (nfn === eval || nfn === Function || nfn === setTimeout || nfn === setInterval) return undefined;
      var nargs = [];
      for (var na = 0; na < expr.args.length; na++) nargs.push(evalExpr(expr.args[na], el, event));
      return nfn.apply(el, nargs);
    }
    return undefined;
  }

  function runProgram(stmts, el, event) {
    var last;
    for (var i = 0; i < stmts.length; i++) {
      var st = stmts[i];
      if (st.kind === 'stop') { if (event && event.stopPropagation) event.stopPropagation(); continue; }
      if (st.kind === 'prevent') { if (event && event.preventDefault) event.preventDefault(); continue; }
      if (st.kind === 'reload') { location.reload(); continue; }
      if (st.kind === 'print') { if (global.print) global.print(); continue; }
      if (st.kind === 'style') { _tpStyle(el, st.prop, st.value); continue; }
      if (st.kind === 'clstog') {
        if (el && el.classList && el.classList.toggle) {
          if (st.force) el.classList.toggle(st.cls, !!evalExpr(st.force, el, event));
          else el.classList.toggle(st.cls);
        }
        continue;
      }
      if (st.kind === 'closestRm') {
        var node = el && el.closest ? el.closest(st.sel) : null;
        if (node && node.remove) node.remove();
        continue;
      }
      if (st.kind === 'parentRm') {
        var par = el && el[st.which];
        if (par && par.remove) par.remove();
        continue;
      }
      if (st.kind === 'retfalse') { if (event && event.preventDefault) event.preventDefault(); return false; }
      if (st.kind === 'ifs') {
        if (!event || event.target !== el) continue;
        st = { kind: 'call', name: st.name, args: st.args };
      }
      if (st.kind === 'call') {
        if (DENY[st.name]) return;
        var fn = global[st.name];
        if (typeof fn !== 'function') return;
        var args = [];
        for (var a = 0; a < st.args.length; a++) args.push(evalExpr(st.args[a], el, event));
        last = fn.apply(el, args);
      }
    }
    return last;
  }

  function collectElements(root) {
    var list = [];
    if (!root) return list;
    if (root.nodeType === 1) list.push(root);
    var found = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var i = 0; i < found.length; i++) list.push(found[i]);
    return list;
  }

  function sanitizeCss(css) {
    var s = String(css || '');
    if (/javascript\s*:|expression\s*\(|-moz-binding\s*:|@import|behavior\s*:|\\/i.test(s)) return '';
    return s.replace(/url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (_, q, inner) {
      inner = String(inner || '').replace(/^\s+|\s+$/g, '');
      if (/^(data:image\/|#|var\()/i.test(inner)) return 'url(' + inner + ')';
      return 'none';
    });
  }

  function applyInlineStyles(root) {
    var list = collectElements(root.nodeType === 9 ? (root.documentElement || root.body || root) : root);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!el || el.nodeType !== 1 || !el.style || !el.getAttribute) continue;
      var css = el.getAttribute('data-tp-style') || el.getAttribute('style');
      if (!css) continue;
      if (el.removeAttribute) {
        el.removeAttribute('data-tp-style');
        el.removeAttribute('style');
      }
      el.style.cssText = sanitizeCss(css);
    }
  }

  function hoistStyleAttrs(html) {
    var s = String(html == null ? '' : html);
    if (s.length < 8 || s.indexOf('style') === -1) return s;
    return s.replace(/(\s)style\s*=\s*(["'])([\s\S]*?)\2/gi, function (_, sp, q, css) {
      return sp + 'data-tp-style=' + q + css + q;
    });
  }

  function sanitizeTree(root) {
    if (!root || !root.querySelectorAll) return;
    var list = collectElements(root.nodeType === 9 ? (root.documentElement || root.body || root) : root);
    for (var n = 0; n < list.length; n++) {
      var el = list[n];
      if (!el || el.nodeType !== 1) continue;
      var tag = String(el.tagName || '').toLowerCase();
      if (tag === 'script' || tag === 'object' || tag === 'embed' || tag === 'base' || tag === 'applet' || tag === 'style') {
        if (el.remove) el.remove();
        else if (el.parentNode) el.parentNode.removeChild(el);
        continue;
      }
      if (tag === 'link') {
        var rel = String(el.getAttribute('rel') || '').toLowerCase();
        if (rel.indexOf('import') >= 0) {
          if (el.remove) el.remove();
          else if (el.parentNode) el.parentNode.removeChild(el);
          continue;
        }
        if (rel.indexOf('stylesheet') >= 0) {
          var href = String(el.getAttribute('href') || '');
          var origin = (global.location && global.location.origin) || '';
          var selfCss = href.charAt(0) === '/' || (origin && href.indexOf(origin) === 0);
          var fontCss = /^https:\/\/fonts\.googleapis\.com\//i.test(href);
          if (!selfCss && !fontCss) {
            if (el.remove) el.remove();
            else if (el.parentNode) el.parentNode.removeChild(el);
          }
        }
        continue;
      }
      if (tag === 'meta') {
        var http = String(el.getAttribute('http-equiv') || '').toLowerCase();
        if (http === 'refresh' || http === 'content-security-policy') {
          if (el.remove) el.remove();
          else if (el.parentNode) el.parentNode.removeChild(el);
        }
        continue;
      }
      if (tag === 'iframe' || tag === 'frame') {
        var frameSrc = String(el.getAttribute('src') || '');
        if (el.getAttribute('srcdoc') || !FRAME_OK.test(frameSrc)) {
          if (el.remove) el.remove();
          else if (el.parentNode) el.parentNode.removeChild(el);
        }
        continue;
      }
      var href = el.getAttribute && el.getAttribute('href');
      if (href && /^\s*javascript:/i.test(href)) el.removeAttribute('href');
      var src = el.getAttribute && el.getAttribute('src');
      if (src && /^\s*javascript:/i.test(src)) el.removeAttribute('src');
      var xlink = el.getAttribute && el.getAttribute('xlink:href');
      if (xlink && /^\s*javascript:/i.test(xlink)) el.removeAttribute('xlink:href');
    }
  }

  function afterHtmlWrite(root) {
    if (!root) return;
    sanitizeTree(root);
    applyInlineStyles(root);
    bindTree(root);
  }

  function bindTree(root) {
    if (!root || root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    var nodes = collectElements(root.nodeType === 9 ? (root.documentElement || root.body || root) : root);
    for (var n = 0; n < nodes.length; n++) {
      var el = nodes[n];
      if (!el.attributes) continue;
      var attrs = [];
      for (var a = 0; a < el.attributes.length; a++) attrs.push(el.attributes[a]);
      for (var b = 0; b < attrs.length; b++) {
        var attr = attrs[b];
        if (!ON_RE.test(attr.name)) continue;
        var type = attr.name.slice(2).toLowerCase();
        var code = attr.value;
        el.removeAttribute(attr.name);
        var prog = parseProgram(code);
        if (!prog) continue;
        el.addEventListener(type, function (progRef) {
          return function (event) {
            return runProgram(progRef, this, event);
          };
        }(prog));
      }
    }
  }

  function patchSetter(proto, prop) {
    var desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.set || !desc.get) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () { return desc.get.call(this); },
      set: function (v) {
        desc.set.call(this, hoistStyleAttrs(v));
        afterHtmlWrite(this);
      }
    });
  }

  patchSetter(Element.prototype, 'innerHTML');
  patchSetter(Element.prototype, 'outerHTML');
  var adj = Element.prototype.insertAdjacentHTML;
  if (adj) {
    Element.prototype.insertAdjacentHTML = function (pos, html) {
      adj.call(this, pos, hoistStyleAttrs(html));
      var root = (pos === 'beforebegin' || pos === 'afterend') ? this.parentNode : this;
      if (root) afterHtmlWrite(root);
    };
  }

  global._tpBindInline = bindTree;
  global._tpParseInline = parseProgram;
  global._tpSanitizeCss = sanitizeCss;
  global._tpHoistStyles = hoistStyleAttrs;
  global._tpInlineDeny = DENY;

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  onReady(function () { afterHtmlWrite(document); });
})(window);

function _tpStyle(el, prop, val) {
  if (!el || !el.style || !/^[a-zA-Z]+$/.test(String(prop || ''))) return;
  el.style[prop] = val == null ? '' : String(val);
}
function _tpStyle2(el, p1, v1, p2, v2) { _tpStyle(el, p1, v1); _tpStyle(el, p2, v2); }
function _tpHideShowNext(el, nextDisplay) {
  if (!el) return;
  el.style.display = 'none';
  if (el.nextElementSibling) el.nextElementSibling.style.display = nextDisplay || 'block';
}
function _tpGo(page) { currentPage = page; renderPage(); }
function _tpGoTeamHome() { currentPage = _teamDefaultPage(); renderPage(); }
function _tpPaymentsTab(tab, rerenderPage) {
  _paymentsTab = tab;
  currentPage = 'payments';
  if (rerenderPage) renderPage();
  else renderPayments();
}
function _tpWelcome(step) { _welcomeStep = step; _renderWelcomeStep(); }
function _tpFaDigits(el) {
  if (!el) return;
  el.value = String(el.value || '').replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); });
}
function _tpNavDragStart(el, i) { if (el) el.style.opacity = '.4'; window._dragNavIdx = i; }
function _tpNavDragEnd(el) { if (el) el.style.opacity = '1'; renderNavOrderEditor(); }
function _tpTogglePassword(id) {
  var i = document.getElementById(id);
  if (i) i.type = i.type === 'password' ? 'text' : 'password';
}
function _tpHideAuthShowApp() {
  var a = document.getElementById('auth-screen');
  var app = document.getElementById('app');
  if (a) a.style.display = 'none';
  if (app) app.style.display = '';
  // Guest entry must actively resolve the requested hash; merely revealing the
  // shell leaves #calendar on the startup placeholder until the watchdog fires.
  window.setTimeout(function () {
    if (typeof renderPage === 'function') renderPage();
  }, 0);
}
function _tpCopyElText(id, msg) {
  var el = document.getElementById(id);
  var t = el ? String(el.textContent || '').trim() : '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(function () { showToast(msg || 'کپی شد ✓', 'success'); });
  }
}
function _tpAdminDeleteFrom(el) { _adminDeleteUser(el.dataset.uid, el.dataset.uname); }
function _tpHideBrokenImg(el) { if (el) el.style.display = 'none'; }
function _tpImgParentPlaceholder(el) {
  if (el && el.parentElement) {
    el.parentElement.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:18px">📷</div>';
  }
}
function _tpTodoStaffField(field, el) {
  _todoStaffFilter[field] = el.value;
  _renderTodoStaffFilteredList();
}
function _tpTodoReportRange(el, mode) {
  _todoReportFilter.range = el.value;
  if (mode === 'modal' && _todoStaffReportId) {
    var body = document.querySelector('.modal-overlay.open .modal-body');
    if (body) body.innerHTML = _todoReportForStaffHtml(_todoStaffReportId);
    return;
  }
  if (mode === 'list') renderTodoList();
  else _renderTodoStaffFilteredList();
}
function _tpTodoCalCursor(j, mode) { _todoCalendarCursor = j; _setTodoViewMode(mode); }
function _tpHabitFilter(k) { _habitFilter = k; renderHabits(); }
function _tpClearModals() { var m = document.getElementById('modals'); if (m) m.innerHTML = ''; }
function _tpClearModalsIfSelf(event) {
  if (event && event.target === event.currentTarget) _tpClearModals();
}
function _tpFocus(id) { var el = document.getElementById(id); if (el) el.focus(); }
function _tpClickId(id) { var el = document.getElementById(id); if (el) el.click(); }
function _tpEvalTab(which) {
  var forms = document.getElementById('eval-panel-forms');
  var ach = document.getElementById('eval-panel-ach');
  var tabF = document.getElementById('eval-tab-forms');
  var tabA = document.getElementById('eval-tab-ach');
  var showForms = which === 'forms';
  if (forms) forms.style.display = showForms ? 'block' : 'none';
  if (ach) ach.style.display = showForms ? 'none' : 'block';
  if (tabF) { tabF.style.background = showForms ? 'var(--accent)' : 'var(--bg3)'; tabF.style.color = showForms ? 'white' : 'var(--text2)'; }
  if (tabA) { tabA.style.background = showForms ? 'var(--bg3)' : 'var(--accent)'; tabA.style.color = showForms ? 'var(--text2)' : 'white'; }
}
function _tpSignOut() { if (_auth && typeof _auth.signOut === 'function') _auth.signOut(); }
function _tpWalletNav() { _sbUser ? openWalletPanel() : _showAuthScreen('login'); }
function _tpOpenAdminPanel() {
  currentPage = 'admin_panel';
  location.hash = '#admin_panel';
  renderPage();
  closeSidebar();
}
function _tpAuthThenBackup() { _checkAuthThen(manualBackup); }
function _tpAuthThenImport() { _checkAuthThen(importBackup); }
function _tpFocusOnEnter(event, id) {
  if (!event || event.key !== 'Enter') return;
  if (event.preventDefault) event.preventDefault();
  _tpFocus(id);
}
function _tpSafeCall(name) {
  var key = String(name || '');
  if (!/^[A-Za-z_][\w]*$/.test(key)) return;
  if ((window._tpInlineDeny && window._tpInlineDeny[key]) || key.indexOf('_tpUnsafe') === 0) return;
  if (key === 'eval' || key === 'Function' || key === 'setTimeout' || key === 'setInterval' || key === '_tpSafeCall') return;
  var fn = window[key];
  if (typeof fn !== 'function') return;
  if (fn === eval || fn === Function || fn === setTimeout || fn === setInterval) return;
  return fn.apply(null, Array.prototype.slice.call(arguments, 1));
}
function _tpOnEnter(event, name) {
  if (!event || event.key !== 'Enter') return;
  if (event.preventDefault) event.preventDefault();
  _tpSafeCall(name);
}
function _tpOnEnter1(event, name, a) {
  if (!event || event.key !== 'Enter') return;
  if (event.preventDefault) event.preventDefault();
  _tpSafeCall(name, a);
}
function _tpOnEnter2(event, name, a, b) {
  if (!event || event.key !== 'Enter') return;
  if (event.preventDefault) event.preventDefault();
  _tpSafeCall(name, a, b);
}
function _tpOnCtrlEnter1(event, name, a) {
  if (!event || event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
  if (event.preventDefault) event.preventDefault();
  _tpSafeCall(name, a);
}
function _tpOnEnterOrSpace(event, name) {
  if (!event || (event.key !== 'Enter' && event.key !== ' ')) return;
  if (event.preventDefault) event.preventDefault();
  _tpSafeCall(name);
}
function _tpPrint() { if (typeof print === 'function') print(); }
function _tpSetInputValue(id, val) {
  var el = document.getElementById(id);
  if (el) el.value = val == null ? '' : String(val);
}
function _tpLater(name, ms) {
  var key = String(name || '');
  if (!/^[A-Za-z_][\w]*$/.test(key)) return;
  setTimeout(function () { _tpSafeCall(key); }, Math.max(0, Number(ms) || 0));
}
function _tpCopyGlobal(key, msg) {
  if (!/^_[A-Za-z_]\w*$/.test(String(key || ''))) return;
  copyToClipboard(window[key] || '', msg);
}
function _tpInstrFilter(key) {
  _instrFilter = key;
  renderInstructions();
}
function _tpOpenCalendarCreate(kind) {
  _openCalendarCreate(kind, (typeof _todoCalendarSelectedDate !== 'undefined' && _todoCalendarSelectedDate) || _todayJalaliStr());
}
function _tpRemoveNewTopicCheckItem(el, idx) {
  if (el && el.parentNode && el.parentNode.remove) el.parentNode.remove();
  if (typeof _newTopicChecklist !== 'undefined' && Array.isArray(_newTopicChecklist)) _newTopicChecklist.splice(idx, 1);
}
function _tpToggleCheckLabel(el) {
  if (!el || !el.classList) return;
  el.classList.toggle('checked');
  var inp = el.querySelector && el.querySelector('input');
  if (inp) inp.checked = el.classList.contains('checked');
}
function _tpSyncPkgCheckFromInput(el) {
  var wrap = el && el.closest && el.closest('.pkg-check');
  if (wrap && wrap.classList) wrap.classList.toggle('checked', !!(el && el.checked));
}
function _tpToggleTut(el) {
  var body = el && el.parentElement && el.parentElement.querySelector && el.parentElement.querySelector('.tut-body');
  if (!body || !body.style) return;
  body.style.display = body.style.display === 'none' ? 'block' : 'none';
}
function _tpPickInstrIcon(inputId, btnSel, el, icon) {
  _tpSetInputValue(inputId, icon);
  var btns = document.querySelectorAll(btnSel);
  for (var i = 0; i < btns.length; i++) { if (btns[i].style) btns[i].style.background = 'var(--bg3)'; }
  if (el && el.style) el.style.background = 'var(--accent2)33';
}
function _tpPickInstrColor(inputId, dotSel, el, color) {
  _tpSetInputValue(inputId, color);
  var dots = document.querySelectorAll(dotSel);
  for (var i = 0; i < dots.length; i++) { if (dots[i].style) dots[i].style.outline = 'none'; }
  if (el && el.style) el.style.outline = '3px solid var(--text)';
}
function _tpVisionMusic(el) {
  var f = el && el.files && el.files[0];
  if (typeof _visionHandleMusic === 'function') _visionHandleMusic(f);
}
function _adminChangePlanSelected() {
  var ids = [];
  if (typeof _adminSelectedUsers !== 'undefined' && _adminSelectedUsers) {
    if (typeof _adminSelectedUsers.forEach === 'function') _adminSelectedUsers.forEach(function (v) { ids.push(v); });
    else ids = Array.prototype.slice.call(_adminSelectedUsers);
  }
  _adminChangePlan(ids);
}
function _tpCancelArchiveLoss() {
  window._pendingArchiveLoss = null;
  if (typeof closeModal === 'function') closeModal();
  if (typeof renderArchive === 'function') renderArchive();
}
