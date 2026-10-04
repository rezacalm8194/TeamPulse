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
  isAllowedStaticPath,
  classifyStaticPath,
  createBlockSensitiveStatic,
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

  const bareJson = mockRes();
  setStaticCacheHeaders(bareJson, '/x/manifest.json', { url: '/manifest.json' });
  assert.equal(bareJson.headers['cache-control'], UNVERSIONED_JS_CSS_CACHE);

  const versionedJson = mockRes();
  setStaticCacheHeaders(versionedJson, '/x/manifest.json', { query: { v: '5' } });
  assert.equal(versionedJson.headers['cache-control'], VERSIONED_JS_CSS_CACHE);

  const html = mockRes();
  setStaticCacheHeaders(html, path.join('/x', 'app.html'), { url: '/app' }, "default-src 'self'");
  assert.equal(html.headers['cache-control'], HTML_CACHE);
  assert.equal(html.headers['content-security-policy'], "default-src 'self'");
});

test('versioned icon images are immutable while the root ICO remains revalidatable', () => {
  const versionedIcon = mockRes();
  setStaticCacheHeaders(versionedIcon, '/x/favicon-32.png', { query: { v: '1' } });
  assert.equal(versionedIcon.headers['cache-control'], VERSIONED_JS_CSS_CACHE);

  const legacyFavicon = mockRes();
  setStaticCacheHeaders(legacyFavicon, '/x/favicon.ico', { url: '/favicon.ico' });
  assert.equal(legacyFavicon.headers['cache-control'], 'public, max-age=604800');
});

test('static allowlist publishes only client assets and blocks repo internals', () => {
  assert.equal(classifyStaticPath('/app.js'), 'allow');
  assert.equal(classifyStaticPath('/app.css'), 'allow');
  assert.equal(classifyStaticPath('/landing.js'), 'allow');
  assert.equal(classifyStaticPath('/blog/index.html'), 'allow');
  assert.equal(classifyStaticPath('/fonts/Vazirmatn-Regular.woff2'), 'allow');
  assert.equal(classifyStaticPath('/privacy.html'), 'allow');

  assert.equal(classifyStaticPath('/scripts/precompress-assets.js'), 'block');
  assert.equal(classifyStaticPath('/scripts/pachim-deploy.sh'), 'block');
  assert.equal(classifyStaticPath('/CURSOR.md'), 'block');
  assert.equal(classifyStaticPath('/backend/tests/static-serving.test.js'), 'block');
  assert.equal(classifyStaticPath('/backend/server.js'), 'block');
  assert.equal(classifyStaticPath('/server.backup-before-speech-fix.js'), 'block');
  assert.equal(classifyStaticPath('/admin.js'), 'block');
  assert.equal(classifyStaticPath('/reminders.js'), 'block');
  assert.equal(classifyStaticPath('/teampulse/backend/package.json'), 'block');
  assert.equal(classifyStaticPath('/teampulse/scripts/pachim-deploy.sh'), 'block');
  assert.equal(classifyStaticPath('/fonts/README.md'), 'block');
  assert.equal(classifyStaticPath('/fonts/OFL.txt'), 'block');
  assert.equal(classifyStaticPath('/deploy-all.bat'), 'block');
  assert.equal(isAllowedStaticPath('/app.js'), true);
  assert.equal(isAllowedStaticPath('/CURSOR.md'), false);
  assert.equal(classifyStaticPath('/app'), 'passthrough');
});

test('blockSensitiveStatic returns 404 for nested copies and source files', async () => {
  const express = require('express');
  const http = require('http');
  const app = express();
  app.use(createBlockSensitiveStatic());
  app.use((req, res) => res.status(200).send('ok'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const blocked = [
      '/scripts/precompress-assets.js',
      '/CURSOR.md',
      '/backend/tests/jwt.test.js',
      '/server.backup-before-speech-fix.js',
      '/teampulse/backend/server.js',
    ];
    for (const url of blocked) {
      const res = await fetch(`http://127.0.0.1:${port}${url}`);
      assert.equal(res.status, 404, url);
    }
    const allowed = await fetch(`http://127.0.0.1:${port}/app.js`);
    assert.equal(allowed.status, 200);
    assert.equal(await allowed.text(), 'ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
