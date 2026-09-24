const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-box-test-key';

const {
  PREFIX,
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
} = require('../utils/secretBox');
const core = require('../utils/balePayCore');
const { ensureBusinessStoreSchema } = require('../utils/businessStore');
const Database = require('better-sqlite3');

test('secretBox round-trips and rejects plaintext storage of bot tokens', () => {
  const token = '123456:ABC-TESTTOKEN';
  const sealed = encryptSecret(token);
  assert.equal(isEncryptedSecret(sealed), true);
  assert.equal(sealed.startsWith(PREFIX), true);
  assert.equal(sealed.includes(token), false);
  assert.equal(decryptSecret(sealed), token);
  assert.equal(decryptSecret(token), token);
});

test('persistCredentials stores encrypted bot tokens in sqlite', () => {
  const db = new Database(':memory:');
  ensureBusinessStoreSchema(db);
  core.setBaleDb(db);
  core.ensureBaleSchema();
  core.persistCredentials({
    ownerAccountId: 'acc_enc',
    workspaceId: 'default',
    botToken: '123456:ABC-TESTTOKEN',
    providerToken: core.TEST_PROVIDER_TOKEN,
    botUsername: 'bot',
    botId: '1',
  });
  const raw = db.prepare(
    'SELECT bot_token, provider_token FROM bale_workspace_credentials WHERE owner_account_id=?'
  ).get('acc_enc');
  assert.equal(isEncryptedSecret(raw.bot_token), true);
  assert.equal(raw.bot_token.includes('ABC-TESTTOKEN'), false);
  const opened = core.getCredentials('acc_enc', 'default');
  assert.equal(opened.bot_token, '123456:ABC-TESTTOKEN');
  assert.equal(opened.provider_token, core.TEST_PROVIDER_TOKEN);
  core.setBaleDb(null);
});
