'use strict';

const path = require('path');
const fs = require('fs');

const PRECOMPRESS_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
};

const VERSIONED_JS_CSS_CACHE = 'public, max-age=31536000, immutable';
const UNVERSIONED_JS_CSS_CACHE = 'public, max-age=300';
const FONT_IMAGE_CACHE = 'public, max-age=604800';
const HTML_CACHE = 'no-cache';

const BLOCKED_STATIC_SEGMENTS = new Set([
  'backend',
  'scripts',
  'tests',
  'teampulse',
  'node_modules',
  'win_package',
  '.git',
  '.cursor',
  '.agents',
  '.codex',
  '.trash',
  '.github',
  '.vscode',
]);

const PUBLIC_STATIC_ROOT_FILES = new Set([
  'index.html',
  'app.html',
  'privacy.html',
  'oauth_callback.html',
  '502.html',
  'app.js',
  'app.css',
  'app-extra.js',
  'app-todos.js',
  'app-finance.js',
  'app-sessions.js',
  'tp-inline-bind.js',
  'landing.js',
  'sw.js',
  'xlsx.full.min.js',
  'manifest.json',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'favicon.ico',
  'favicon.png',
  'favicon-32.png',
  'logo.png',
  'app-icon-192-v3.png',
  'app-icon-512-v3.png',
  'notification-badge.png',
  'notification-badge.svg',
]);

function normalizeStaticPath(reqPath) {
  let raw = String(reqPath || '').split('?')[0];
  try {
    raw = decodeURIComponent(raw);
  } catch (_) {
    return null;
  }
  if (!raw || raw.includes('\0')) return null;
  raw = raw.replace(/\\/g, '/');
  if (!raw.startsWith('/')) raw = '/' + raw;
  const parts = raw.split('/').filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..')) return null;
  return '/' + parts.join('/');
}

function lastSegmentHasDot(pathname) {
  const name = String(pathname || '').split('/').pop() || '';
  return name.includes('.');
}

function isAllowedStaticPath(reqPath) {
  const pathname = normalizeStaticPath(reqPath);
  if (!pathname || pathname === '/') return false;
  const parts = pathname.slice(1).split('/');
  if (parts.some((part) => BLOCKED_STATIC_SEGMENTS.has(part.toLowerCase()))) return false;

  if (parts.length === 1) {
    return PUBLIC_STATIC_ROOT_FILES.has(parts[0].toLowerCase());
  }
  if (parts.length === 2 && parts[0].toLowerCase() === 'blog') {
    return /^[a-z0-9][a-z0-9._-]*\.html$/i.test(parts[1]);
  }
  if (parts.length === 2 && parts[0].toLowerCase() === 'fonts') {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:woff2|css)$/i.test(parts[1]);
  }
  return false;
}

function classifyStaticPath(reqPath) {
  const pathname = normalizeStaticPath(reqPath);
  if (!pathname) return 'block';
  if (pathname === '/') return 'passthrough';
  const parts = pathname.slice(1).split('/');
  if (parts.some((part) => BLOCKED_STATIC_SEGMENTS.has(part.toLowerCase()))) return 'block';
  if (isAllowedStaticPath(pathname)) return 'allow';
  if (lastSegmentHasDot(pathname)) return 'block';
  return 'passthrough';
}

function createBlockSensitiveStatic() {
  return function blockSensitiveStatic(req, res, next) {
    if (classifyStaticPath(req.path) === 'block') {
      return res.status(404).send('Not found');
    }
    next();
  };
}

/**
 * Parse one encoding's q-value from Accept-Encoding.
 * Missing encoding → 0 (do not invent support). Explicit q=0 → 0.
 */
function encodingQuality(acceptHeader, encodingName) {
  const header = String(acceptHeader || '').trim();
  if (!header) return 0;
  const wanted = String(encodingName || '').toLowerCase();
  if (!wanted) return 0;

  let starQ = null;
  let encQ = null;

  for (const rawPart of header.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const bits = part.split(';').map((s) => s.trim());
    const name = String(bits[0] || '').toLowerCase();
    let q = 1;
    for (let i = 1; i < bits.length; i += 1) {
      const m = /^q\s*=\s*([0-9.]+)$/i.exec(bits[i]);
      if (!m) continue;
      const parsed = Number(m[1]);
      q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
    }
    if (name === wanted) encQ = q;
    else if (name === '*') starQ = q;
  }

  if (encQ !== null) return encQ;
  if (starQ !== null) return starQ;
  return 0;
}

function isVersionedAssetRequest(req) {
  if (!req) return false;
  const q = req.query && req.query.v;
  if (q !== undefined && q !== null && String(q).length > 0) return true;
  const url = String(req.url || req.originalUrl || '');
  return /(?:\?|&)v=[^&]+/.test(url);
}

function setStaticCacheHeaders(res, filePath, req, cspValue) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') {
    res.setHeader('Cache-Control', HTML_CACHE);
    if (cspValue) res.setHeader('Content-Security-Policy', cspValue);
    return;
  }
  if (/\.(?:css|js|mjs)$/i.test(ext)) {
    if (isVersionedAssetRequest(req || res.req)) {
      res.setHeader('Cache-Control', VERSIONED_JS_CSS_CACHE);
    } else {
      res.setHeader('Cache-Control', UNVERSIONED_JS_CSS_CACHE);
    }
    return;
  }
  if (/\.json$/i.test(ext)) {
    // Versioned manifests (manifest.json?v=…) can be cached hard; bare JSON stays short.
    if (isVersionedAssetRequest(req || res.req)) {
      res.setHeader('Cache-Control', VERSIONED_JS_CSS_CACHE);
    } else {
      res.setHeader('Cache-Control', UNVERSIONED_JS_CSS_CACHE);
    }
    return;
  }
  if (/\.(?:png|jpe?g|webp|gif|svg|woff2?|ttf)$/i.test(ext)) {
    // A versioned icon/image URL is content-addressed by its version token.
    // Keep the unversioned root favicon out of this branch: browsers routinely
    // revalidate it, so it must remain a real, small static file.
    res.setHeader(
      'Cache-Control',
      isVersionedAssetRequest(req || res.req) ? VERSIONED_JS_CSS_CACHE : FONT_IMAGE_CACHE
    );
    return;
  }
  if (ext === '.ico') {
    res.setHeader('Cache-Control', FONT_IMAGE_CACHE);
  }
}

function pickPrecompressedCandidate(acceptHeader, absPath, srcStat, io = fs) {
  const ranked = [
    { encoding: 'br', q: encodingQuality(acceptHeader, 'br') },
    { encoding: 'gzip', q: encodingQuality(acceptHeader, 'gzip') },
  ]
    .filter((item) => item.q > 0)
    .sort((a, b) => b.q - a.q || (a.encoding === 'br' ? -1 : 1));

  for (const item of ranked) {
    const file = absPath + (item.encoding === 'br' ? '.br' : '.gz');
    try {
      const st = io.statSync(file);
      if (st.isFile() && st.mtimeMs >= srcStat.mtimeMs) {
        return { file, encoding: item.encoding };
      }
    } catch (_) {
      // try next
    }
  }
  return null;
}

function createServePrecompressedStatic({ root, cspValue, io = fs } = {}) {
  const staticRoot = path.resolve(root);
  return function servePrecompressedStatic(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.headers.range) return next();
    const rel = decodeURIComponent((req.path || '').split('?')[0] || '');
    if (!rel || rel.includes('\0') || rel.includes('\\')) return next();
    if (!isAllowedStaticPath(rel)) return next();
    if (!/\.(?:js|mjs|css|html|svg|json)$/i.test(rel)) return next();
    const abs = path.resolve(staticRoot, '.' + rel);
    const rootPrefix = staticRoot.endsWith(path.sep) ? staticRoot : staticRoot + path.sep;
    if (abs !== staticRoot && !abs.startsWith(rootPrefix)) return next();
    let srcStat;
    try {
      srcStat = io.statSync(abs);
    } catch (_) {
      return next();
    }
    if (!srcStat.isFile()) return next();

    const hit = pickPrecompressedCandidate(
      req.headers['accept-encoding'],
      abs,
      srcStat,
      io
    );
    if (!hit) return next();

    const ext = path.extname(abs).toLowerCase();
    if (PRECOMPRESS_TYPES[ext]) res.setHeader('Content-Type', PRECOMPRESS_TYPES[ext]);
    res.setHeader('Content-Encoding', hit.encoding);
    res.setHeader('Vary', 'Accept-Encoding');
    setStaticCacheHeaders(res, abs, req, cspValue);
    return res.sendFile(hit.file, (err) => {
      if (err) next(err);
    });
  };
}

module.exports = {
  PRECOMPRESS_TYPES,
  VERSIONED_JS_CSS_CACHE,
  UNVERSIONED_JS_CSS_CACHE,
  HTML_CACHE,
  BLOCKED_STATIC_SEGMENTS,
  PUBLIC_STATIC_ROOT_FILES,
  encodingQuality,
  isVersionedAssetRequest,
  setStaticCacheHeaders,
  pickPrecompressedCandidate,
  isAllowedStaticPath,
  classifyStaticPath,
  createBlockSensitiveStatic,
  createServePrecompressedStatic,
};
