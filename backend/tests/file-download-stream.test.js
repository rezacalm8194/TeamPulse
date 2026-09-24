const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createLocalDiskDriver } = require('../utils/storage/localDiskDriver');
const { objectKey, sendStoredFile } = require('../utils/fileStore');

function listen(app) {
  const server = http.createServer(app);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function collectStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('local disk driver streams a byte range without reading the whole object', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-stream-'));
  const driver = createLocalDiskDriver(root);
  const key = 'files/acc-1/default/f1';
  driver.putSync(key, Buffer.from('0123456789'));
  const head = driver.readHeadSync(key, 4);
  assert.equal(String(head), '0123');
  const slice = await collectStream(driver.createReadStream(key, { start: 2, end: 5 }));
  assert.equal(String(slice), '2345');
  fs.rmSync(root, { recursive: true, force: true });
});

test('sendStoredFile streams full file and Range requests', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-dl-'));
  const driver = createLocalDiskDriver(root);
  const key = objectKey('acc-1', 'default', 'clip.bin');
  driver.putSync(key, Buffer.from('abcdefghij'));
  const row = { name: 'clip.bin', mime_type: 'application/octet-stream', storage_key: key };
  const app = express();
  app.get('/file', (req, res) => sendStoredFile(req, res, row, driver));
  const { server, port } = await listen(app);
  try {
    const full = await fetch(`http://127.0.0.1:${port}/file`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('content-length'), '10');
    assert.equal(await full.text(), 'abcdefghij');

    const partial = await fetch(`http://127.0.0.1:${port}/file`, { headers: { Range: 'bytes=2-5' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(partial.headers.get('content-length'), '4');
    assert.equal(await partial.text(), 'cdef');

    const suffix = await fetch(`http://127.0.0.1:${port}/file`, { headers: { Range: 'bytes=-3' } });
    assert.equal(suffix.status, 206);
    assert.equal(await suffix.text(), 'hij');

    const bad = await fetch(`http://127.0.0.1:${port}/file`, { headers: { Range: 'bytes=99-100' } });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers.get('content-range'), 'bytes */10');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('file download route streams from disk instead of buffering the whole object', () => {
  const filesRoute = fs.readFileSync(path.join(__dirname, '../routes/files.js'), 'utf8');
  assert.match(filesRoute, /sendStoredFile/);
  assert.doesNotMatch(filesRoute, /readStoredFile/);
  assert.doesNotMatch(filesRoute, /res\.end\(data\)/);
});

test('password hashing on request routes stays async', () => {
  const files = ['auth.js', 'admin.js', 'staff.js'].map(name =>
    fs.readFileSync(path.join(__dirname, '../routes', name), 'utf8')
  );
  for (const source of files) {
    assert.doesNotMatch(source, /hashSync|compareSync/);
    assert.match(source, /await bcrypt\.(hash|compare)/);
  }
});
