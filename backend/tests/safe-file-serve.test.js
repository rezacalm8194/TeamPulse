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

test('svg and xhtml types never stay executable', () => {
  assert.equal(storedMime('image/svg+xml', Buffer.from('<svg></svg>')), 'application/octet-stream');
  assert.equal(storedMime('application/xhtml+xml', Buffer.from('<html></html>')), 'application/octet-stream');
  assert.equal(servedMime('text/javascript', Buffer.from('alert(1)')), 'application/octet-stream');
});
