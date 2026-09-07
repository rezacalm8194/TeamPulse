'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { describe, it } = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('one-click deploy scripts', () => {
  it('production shell deploy resets hard to origin/main and keeps .env', () => {
    const sh = read('scripts/pachim-deploy.sh');
    assert.match(sh, /git fetch origin "\$BRANCH"/);
    assert.match(sh, /git checkout -B "\$BRANCH" "origin\/\$BRANCH"/);
    assert.match(sh, /git reset --hard "origin\/\$BRANCH"/);
    assert.match(sh, /ENV_BACKUP/);
    assert.match(sh, /precompress-assets\.js/);
    assert.doesNotMatch(sh, /git pull origin/);
  });

  it('staging shell deploy resets hard to origin/develop', () => {
    const sh = read('scripts/pachim-deploy-staging.sh');
    assert.match(sh, /git reset --hard "origin\/\$BRANCH"/);
    assert.match(sh, /pm2 restart/);
    assert.doesNotMatch(sh, /git pull origin/);
  });

  it('deploy-all.bat auto-switches to develop and SSHs production sync', () => {
    const bat = read('deploy-all.bat');
    assert.match(bat, /__FROM_TEMP__/);
    assert.match(bat, /teampulse-deploy-all\.bat/);
    assert.match(bat, /git checkout develop/);
    assert.match(bat, /stash push -u -m "deploy-all auto-stash before develop"/);
    assert.match(bat, /PROD_SSH=pachim@37\.32\.12\.186/);
    assert.match(bat, /TeamPulse\.ir/);
    assert.match(bat, /git checkout origin\/main -- scripts\/pachim-deploy\.sh/);
    assert.match(bat, /bash scripts\/pachim-deploy\.sh/);
    assert.match(bat, /develop already matches main/);
    assert.doesNotMatch(bat, /Deploy must run from the develop branch/);
    assert.doesNotMatch(bat, /cd \/d D:\\TeamPulse/);
  });

  it('deploy-staging.bat refreshes remote script before running it', () => {
    const bat = read('deploy-staging.bat');
    assert.match(bat, /git checkout origin\/develop -- scripts\/pachim-deploy-staging\.sh/);
    assert.match(bat, /bash scripts\/pachim-deploy-staging\.sh/);
  });
});
