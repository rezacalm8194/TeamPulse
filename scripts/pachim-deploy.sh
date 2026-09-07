#!/usr/bin/env bash
# Production deploy for Pachim / SSH.
# Syncs the site tree to origin/main even when the server has dirty tracked files
# or no local branch named main/develop. Keeps backend/.env across the reset.

set -euo pipefail

SITE_DIR="${SITE_DIR:-/home/pachim/TeamPulse.ir}"
BRANCH="${BRANCH:-main}"
ENV_FILE="$SITE_DIR/backend/.env"
ENV_BACKUP="/tmp/teampulse.env.bak.$$"
HEALTH_URL="${HEALTH_URL:-https://teampulse.ir/api/health}"

cd "$SITE_DIR"

if [ -f "$ENV_FILE" ]; then
  cp -a "$ENV_FILE" "$ENV_BACKUP"
fi

# Unfinished merge/rebase blocks reset/checkout on some hosts.
git merge --abort >/dev/null 2>&1 || true
git rebase --abort >/dev/null 2>&1 || true

git fetch origin "$BRANCH"

# Create/reset local BRANCH to match GitHub and drop local edits to tracked files.
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

if [ -f "$ENV_BACKUP" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cp -a "$ENV_BACKUP" "$ENV_FILE"
  rm -f "$ENV_BACKUP"
fi

node "$SITE_DIR/scripts/precompress-assets.js"

if [ -f "$SITE_DIR/app.js" ]; then
  echo -n "[deploy] "
  head -n 1 "$SITE_DIR/app.js" || true
fi

if curl -fsS "$HEALTH_URL"; then
  echo
else
  echo "warning: health check failed: $HEALTH_URL" >&2
fi
