const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-ws-log-'));
process.env.LOG_DIR = logDir;
const { retiredWorkspacePayload, sendRetiredWorkspace } = require('../utils/retiredWorkspaceResource');

test.after(() => fs.rmSync(logDir, { recursive: true, force: true }));

test('retired workspace payload points callers at the document store', () => {
  const body = retiredWorkspacePayload('clients');
  assert.equal(body.error, 'legacy_route_retired');
  assert.equal(body.resource, 'clients');
  assert.equal(body.use, '/api/data');
  assert.match(body.message, /user_data_parts/);
});

test('retired workspace handler returns 410 without writing storage', async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'acc-1' };
    next();
  });
  app.all('/api/payments', sendRetiredWorkspace('payments'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const created = await fetch(`http://127.0.0.1:${port}/api/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: 'c1', amount: 10 }),
    });
    assert.equal(created.status, 410);
    const body = await created.json();
    assert.equal(body.error, 'legacy_route_retired');
    assert.equal(body.resource, 'payments');
    assert.equal(created.headers.get('deprecation'), 'true');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
