'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  encodingQuality,
  isVersionedAssetRequest,
  setStaticCacheHeaders,
  pickPrecompressedCandidate,
  VERSIONED_JS_CSS_CACHE,
  UNVERSIONED_JS_CSS_CACHE,
  HTML_CACHE,
} = require('../utils/staticServing');

function mockRes() {
  const headers = Object.create(null);
  return {
    headers,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
  };
}

test('encodingQuality respects q=0 and prefers higher q', () => {
  assert.equal(encodingQuality('gzip;q=0, br;q=0', 'br'), 0);
  assert.equal(encodingQuality('gzip;q=0, br;q=0', 'gzip'), 0);
  assert.equal(encodingQuality('br;q=0.5, gzip', 'gzip'), 1);
  assert.equal(encodingQuality('br;q=0.5, gzip', 'br'), 0.5);
  assert.equal(encodingQuality('gzip, deflate', 'br'), 0);
  assert.equal(encodingQuality('*', 'br'), 1);
  assert.equal(encodingQuality('', 'gzip'), 0);
});

test('pickPrecompressedCandidate skips q=0 and prefers br when both ok', () => {
  const abs = '/tmp/app.js';
  const srcStat = { mtimeMs: 100 };
  const files = {
    '/tmp/app.js.br': { isFile: () => true, mtimeMs: 120 },
    '/tmp/app.js.gz': { isFile: () => true, mtimeMs: 120 },
  };
  const io = {
    statSync(file) {
      const hit = files[file];
      if (!hit) throw Object.assign(new Error('enoent'), { code: 'ENOENT' });
      return hit;
    },
  };

  assert.equal(
    pickPrecompressedCandidate('gzip;q=0, br;q=0', abs, srcStat, io),
    null
  );
  assert.deepEqual(
    pickPrecompressedCandidate('br, gzip', abs, srcStat, io),
    { file: '/tmp/app.js.br', encoding: 'br' }
  );
  assert.deepEqual(
    pickPrecompressedCandidate('gzip', abs, srcStat, io),
    { file: '/tmp/app.js.gz', encoding: 'gzip' }
  );
});

test('versioned JS/CSS get immutable cache; bare JS/CSS stay short-lived', () => {
  assert.equal(isVersionedAssetRequest({ query: { v: 'tp187' } }), true);
  assert.equal(isVersionedAssetRequest({ url: '/app.js?v=tp187' }), true);
  assert.equal(isVersionedAssetRequest({ url: '/app.js' }), false);
  assert.equal(isVersionedAssetRequest({ query: {} }), false);

  const versioned = mockRes();
  setStaticCacheHeaders(versioned, '/x/app.js', { query: { v: 'tp187' } });
  assert.equal(versioned.headers['cache-control'], VERSIONED_JS_CSS_CACHE);

  const bare = mockRes();
  setStaticCacheHeaders(bare, '/x/app.js', { url: '/app.js' });
  assert.equal(bare.headers['cache-control'], UNVERSIONED_JS_CSS_CACHE);

  const html = mockRes();
  setStaticCacheHeaders(html, path.join('/x', 'app.html'), { url: '/app' }, "default-src 'self'");
  assert.equal(html.headers['cache-control'], HTML_CACHE);
  assert.equal(html.headers['content-security-policy'], "default-src 'self'");
});
