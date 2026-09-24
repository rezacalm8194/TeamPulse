'use strict';

const MIME_TOKEN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

const INLINE_SAFE_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/aac',
  'video/mp4', 'video/webm', 'video/ogg',
]);

function normalizeMime(raw) {
  const mime = String(raw || '').split(';')[0].trim().toLowerCase();
  return MIME_TOKEN.test(mime) ? mime : 'application/octet-stream';
}

function isActiveMime(raw) {
  const mime = normalizeMime(raw);
  const sub = mime.split('/')[1] || '';
  return (
    sub === 'html' ||
    sub === 'xhtml' ||
    sub === 'xml' ||
    sub === 'xsl' ||
    sub === 'javascript' ||
    sub === 'x-javascript' ||
    sub === 'ecmascript' ||
    sub === 'wasm' ||
    sub.endsWith('+xml') ||
    sub.includes('html') ||
    sub.includes('javascript') ||
    sub.includes('ecmascript') ||
    sub.includes('svg')
  );
}

function looksLikeActiveMarkup(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
  if (!buf.length) return false;
  let start = 0;
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) start = 3;
  const head = buf.subarray(start, Math.min(buf.length, start + 1024)).toString('latin1');
  const trimmed = head.replace(/^\s+/, '');
  return /^\s*(?:<!(?:doctype\s+html|\[)|<(?:html|svg|script|iframe|object|embed|math|body|head|xhtml|xml|!entity)\b|<\?xml\b[\s\S]{0,400}<(?:svg|html|script|xhtml)\b)/i.test(trimmed);
}

function storedMime(raw, data) {
  const mime = normalizeMime(raw);
  if (isActiveMime(mime) || looksLikeActiveMarkup(data)) return 'application/octet-stream';
  return mime;
}

function servedMime(raw, data) {
  const mime = storedMime(raw, data);
  if (!INLINE_SAFE_MIME.has(mime) || looksLikeActiveMarkup(data)) return 'application/octet-stream';
  return mime;
}

function safeDownloadName(name) {
  const base = String(name || 'file').replace(/[\r\n]/g, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 180) || 'file';
  if (/\.(?:html?|xhtml|svg|xml|js|mjs|cjs|htm|shtml|svgz|wasm)$/i.test(base)) {
    return `${base}.download`;
  }
  return base;
}

function contentDisposition(name) {
  const encoded = encodeURIComponent(safeDownloadName(name)).slice(0, 240);
  return `attachment; filename*=UTF-8''${encoded}`;
}

function parseBytesRange(rangeHeader, size) {
  const total = Number(size);
  if (!Number.isFinite(total) || total < 0) return { unsatisfiable: true };
  if (!rangeHeader) {
    return total === 0
      ? { start: 0, end: -1, partial: false }
      : { start: 0, end: total - 1, partial: false };
  }
  const raw = String(rangeHeader).trim();
  if (!raw) {
    return total === 0
      ? { start: 0, end: -1, partial: false }
      : { start: 0, end: total - 1, partial: false };
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(raw);
  if (!match || total === 0) return { unsatisfiable: true };
  let start;
  let end;
  if (match[1] === '' && match[2] === '') return { unsatisfiable: true };
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return { unsatisfiable: true };
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? total - 1 : Number(match[2]);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= total) {
    return { unsatisfiable: true };
  }
  end = Math.min(end, total - 1);
  return { start, end, partial: start !== 0 || end !== total - 1 };
}

function applyFileDownloadHeaders(res, name, rawMime, data, extra = {}) {
  const mime = servedMime(rawMime, data);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', contentDisposition(name));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  if (extra.contentRange) res.setHeader('Content-Range', extra.contentRange);
  if (extra.length != null) res.setHeader('Content-Length', String(extra.length));
  else if (extra.size != null) res.setHeader('Content-Length', String(extra.size));
  return mime;
}

module.exports = {
  INLINE_SAFE_MIME,
  normalizeMime,
  isActiveMime,
  looksLikeActiveMarkup,
  storedMime,
  servedMime,
  safeDownloadName,
  contentDisposition,
  parseBytesRange,
  applyFileDownloadHeaders,
};
