#!/usr/bin/env bash
# Production deploy for Pachim / SSH.
# Syncs the site tree to origin/main even when the server has dirty tracked files
# or no local branch named main/develop. Keeps backend/.env across the reset.

set -euo pipefail

SITE_DIR="${SITE_DIR:-/home/pachim/TeamPulse.ir}"
BRANCH="${BRANCH:-main}"
ENV_FILE="$SITE_DIR/backend/.env"
# در $HOME و با mktemp: روی پاچیم /tmp ممکن است فایل هم‌نام از کاربر دیگری داشته باشد (Permission denied)
ENV_BACKUP="$(mktemp "$HOME/.teampulse.env.bak.XXXXXX")"

cd "$SITE_DIR"

if [ -f "$ENV_FILE" ]; then
  cp -a "$ENV_FILE" "$ENV_BACKUP"
fi

git merge --abort >/dev/null 2>&1 || true
git rebase --abort >/dev/null 2>&1 || true

fetch_attempt=1
while ! git fetch origin "$BRANCH"; do
  if [ "$fetch_attempt" -ge 4 ]; then
    echo "[deploy] Git fetch failed after $fetch_attempt attempts." >&2
    exit 1
  fi
  echo "[deploy] Git fetch attempt $fetch_attempt failed; retrying in 5 seconds..." >&2
  fetch_attempt=$((fetch_attempt + 1))
  sleep 5
done

git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

if [ -f "$ENV_BACKUP" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cp -a "$ENV_BACKUP" "$ENV_FILE"
  rm -f "$ENV_BACKUP"
fi

export SITE_DIR
TMPDIR="${TMPDIR:-$HOME}" bash "$SITE_DIR/scripts/pachim-post-pull.sh"