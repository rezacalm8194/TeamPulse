const test = require('node:test');
const assert = require('node:assert/strict');
const {
  storedMime,
  servedMime,
  contentDisposition,
  looksLikeActiveMarkup,
  safeDownloadName,
} = require('../utils/safeFileServe');

test('html uploads are stored and served as octet-stream, never inline', () => {
  const html = Buffer.from('<!doctype html><script>alert(1)</script>');
  assert.equal(storedMime('text/html', html), 'application/octet-stream');
  assert.equal(servedMime('text/html', html), 'application/octet-stream');
  assert.match(contentDisposition('payload.html'), /^attachment;/);
  assert.equal(safeDownloadName('payload.html'), 'payload.html.download');
});

test('claimed jpeg that is actually html is not served as an image', () => {
  const html = Buffer.from('<html><body><svg onload=alert(1)>');
  assert.equal(true, looksLikeActiveMarkup(html));
  assert.equal(servedMime('image/jpeg', html), 'application/octet-stream');
});

test('real jpeg remains a jpeg content type', () => {
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
  assert.equal(servedMime('image/jpeg', jpeg), 'image/jpeg');
  assert.match(contentDisposition('photo.jpg'), /^attachment;/);
});

test('parseBytesRange supports suffix, open-end, and unsatisfiable ranges', () => {
  const { parseBytesRange } = require('../utils/safeFileServe');
  assert.deepEqual(parseBytesRange(undefined, 10), { start: 0, end: 9, partial: false });
  assert.deepEqual(parseBytesRange('bytes=2-5', 10), { start: 2, end: 5, partial: true });
  assert.deepEqual(parseBytesRange('bytes=7-', 10), { start: 7, end: 9, partial: true });
  assert.deepEqual(parseBytesRange('bytes=-4', 10), { start: 6, end: 9, partial: true });
  assert.equal(parseBytesRange('bytes=20-30', 10).unsatisfiable, true);
  assert.equal(parseBytesRange('bytes=1-2,3-4', 10).unsatisfiable, true);
  assert.equal(parseBytesRange('bytes=0-0', 0).unsatisfiable, true);
});

test('svg and xhtml types never stay executable', () => {
  assert.equal(storedMime('image/svg+xml', Buffer.from('<svg></svg>')), 'application/octet-stream');
  assert.equal(storedMime('application/xhtml+xml', Buffer.from('<html></html>')), 'application/octet-stream');
  assert.equal(servedMime('text/javascript', Buffer.from('alert(1)')), 'application/octet-stream');
});
