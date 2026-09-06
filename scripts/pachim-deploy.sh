#!/usr/bin/env bash
# Paste this as the Pachim site deploy script (or run it on the server).
# It keeps production backend/.env so git pull cannot abort on local env edits.

set -euo pipefail

SITE_DIR="${SITE_DIR:-/home/pachim/TeamPulse.ir}"
BRANCH="${BRANCH:-main}"
ENV_FILE="$SITE_DIR/backend/.env"
ENV_BACKUP="/tmp/teampulse.env.bak.$$"

cd "$SITE_DIR"

if [ -f "$ENV_FILE" ]; then
  cp -a "$ENV_FILE" "$ENV_BACKUP"
fi

# Drop tracked .env edits that block merge, then pull.
if git ls-files --error-unmatch backend/.env >/dev/null 2>&1; then
  git checkout -- backend/.env || true
fi
if git ls-files --error-unmatch backend/.env.save >/dev/null 2>&1; then
  git checkout -- backend/.env.save || true
fi

git pull origin "$BRANCH"

if [ -f "$ENV_BACKUP" ]; then
  cp -a "$ENV_BACKUP" "$ENV_FILE"
  rm -f "$ENV_BACKUP"
fi

node "$SITE_DIR/scripts/precompress-assets.js"
