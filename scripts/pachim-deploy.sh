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

# ری‌استارت Node: برنامه زیر supervisord پاچیم با autorestart=true و user=pachim اجرا می‌شود.
# sudo بدون رمز نداریم، پس پروسه خودمان را با SIGTERM می‌بندیم (همان سیگنال stop خود supervisor)
# و supervisor آن را از پوشه فعلی ($SITE_DIR) با کد جدید دوباره بالا می‌آورد.
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
restart_app() {
  local old_pids new_pids i
  old_pids="$(pgrep -u "$(id -u)" -f '^/usr/bin/node backend/server.js' || true)"
  if [ -z "$old_pids" ]; then
    echo "[deploy] warning: node backend/server.js not found; restart it from the Pachim panel" >&2
    return 0
  fi
  echo "[deploy] restarting app (pid $old_pids)"
  kill -TERM $old_pids
  for i in $(seq 1 40); do
    sleep 1
    new_pids="$(pgrep -u "$(id -u)" -f '^/usr/bin/node backend/server.js' || true)"
    if [ -n "$new_pids" ] && [ "$new_pids" != "$old_pids" ] && curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
      echo "[deploy] app restarted (pid $new_pids) after ${i}s"
      return 0
    fi
  done
  echo "[deploy] app did not come back within 40s; restart it from the Pachim panel" >&2
  return 1
}
restart_app

export SITE_DIR
TMPDIR="${TMPDIR:-$HOME}" bash "$SITE_DIR/scripts/pachim-post-pull.sh"