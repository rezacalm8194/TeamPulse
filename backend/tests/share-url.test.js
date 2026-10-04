'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { publicBaseUrl } = require('../utils/balePayCore');

const share = fs.readFileSync(path.join(__dirname, '../routes/share.js'), 'utf8');

test('share create URL ignores Host and requires PUBLIC_BASE_URL outside localhost', () => {
  assert.match(share, /publicBaseUrl\(req\)/);
  assert.match(share, /public_base_url_required/);
  assert.doesNotMatch(share, /req\.get\(['"]host['"]\)/);
  assert.doesNotMatch(share, /x-forwarded-proto/);

  const prev = process.env.PUBLIC_BASE_URL;
  const prevApp = process.env.APP_URL;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_URL;
  try {
    assert.equal(
      publicBaseUrl({
        headers: { 'x-forwarded-proto': 'https', host: 'evil.example' },
        protocol: 'https',
        get: () => 'evil.example',
      }),
      ''
    );
    process.env.PUBLIC_BASE_URL = 'http://teampulse.ir/';
    assert.equal(
      publicBaseUrl({
        headers: { host: 'evil.example' },
        get: () => 'evil.example',
      }),
      'https://teampulse.ir'
    );
  } finally {
    if (prev == null) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = prev;
    if (prevApp == null) delete process.env.APP_URL;
    else process.env.APP_URL = prevApp;
  }
});
