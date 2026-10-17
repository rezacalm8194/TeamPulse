const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

test('paginated finance hydrate raises collection nextId so a new receipt is not reused', () => {
  assert.match(appSource, /function _bumpCollectionNextId\(/);
  assert.match(appSource, /_bumpCollectionNextId\(collection\)/);
  assert.match(appSource, /d\._nextId\[k\]=Math\.max\(Number\(d\._nextId\[k\]\)\|\|1, maxId\+1\)/);
});

test('payments.add skips ids already present after a page hydrate left _nextId at 1', () => {
  const sandbox = { _db: { payments: [{ id: 1 }, { id: 2 }], _nextId: { payments: 1 }, _deletedItems: {} } };
  vm.createContext(sandbox);
  for (const name of ['_collectionIdHighWater', '_bumpCollectionNextId', '_nextId']) {
    vm.runInContext(extractFunction(appSource, name), sandbox);
  }
  const first = sandbox._nextId('payments');
  sandbox._db.payments.push({ id: first });
  const second = sandbox._nextId('payments');
  assert.equal(first, 3);
  assert.equal(second, 4);
});
