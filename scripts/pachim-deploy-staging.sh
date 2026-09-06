#!/usr/bin/env bash
# Paste this as the Pachim staging site deploy script (or run it on the server).
# Pulls develop, keeps staging backend/.env, installs deps, restarts PM2.

set -euo pipefail

SITE_DIR="${SITE_DIR:-/home/pachim/staging.teampulse.ir}"
BRANCH="${BRANCH:-develop}"
ENV_FILE="$SITE_DIR/backend/.env"
ENV_BACKUP="/tmp/teampulse-staging.env.bak.$$"
PM2_APP="${PM2_APP:-teampulse-staging}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3002/api/health}"

cd "$SITE_DIR"

if [ -f "$ENV_FILE" ]; then
  cp -a "$ENV_FILE" "$ENV_BACKUP"
fi

# Drop tracked .env edits that block merge, then pull.
if git ls-files --error-unmatch backend/.env >/dev/null 2>&1; then
  git checkout HEAD -- backend/.env || true
fi
if git ls-files --error-unmatch backend/.env.save >/dev/null 2>&1; then
  git checkout HEAD -- backend/.env.save || true
fi

git pull origin "$BRANCH"

if [ -f "$ENV_BACKUP" ]; then
  cp -a "$ENV_BACKUP" "$ENV_FILE"
  rm -f "$ENV_BACKUP"
fi

node "$SITE_DIR/scripts/precompress-assets.js"

cd "$SITE_DIR/backend"
npm install --omit=dev
pm2 restart "$PM2_APP" --update-env

# Wait for the process to bind PORT before health-checking.
ok=0
i=1
while [ "$i" -le 20 ]; do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
  i=$((i + 1))
done

if [ "$ok" -ne 1 ]; then
  echo "health check failed: $HEALTH_URL" >&2
  pm2 logs "$PM2_APP" --err --lines 40 --nostream >&2 || true
  exit 1
fi

curl -fsS "$HEALTH_URL"
echo
