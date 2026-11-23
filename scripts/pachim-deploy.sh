#!/usr/bin/env bash
# Production deploy for Pachim / SSH.
# Syncs the site tree to origin/main even when the server has dirty tracked files
# or no local branch named main/develop. Keeps backend/.env across the reset.

set -euo pipefail

SITE_DIR="${SITE_DIR:-/home/pachim/TeamPulse.ir}"
BRANCH="${BRANCH:-main}"
ENV_FILE="$SITE_DIR/backend/.env"
ENV_BACKUP="/tmp/teampulse.env.bak.$$"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://teampulse.ir}"

cd "$SITE_DIR"

if [ -f "$ENV_FILE" ]; then
  cp -a "$ENV_FILE" "$ENV_BACKUP"
fi

# Unfinished merge/rebase blocks reset/checkout on some hosts.
git merge --abort >/dev/null 2>&1 || true
git rebase --abort >/dev/null 2>&1 || true

# Pachim may start its automatic hook while the desktop deploy is still
# finishing. Wait out that short overlap instead of failing on origin/main's
# compare-and-swap ref update.
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

# Create/reset local BRANCH to match GitHub and drop local edits to tracked files.
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

if [ -f "$ENV_BACKUP" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cp -a "$ENV_BACKUP" "$ENV_FILE"
  rm -f "$ENV_BACKUP"
fi

strip_precompressed() {
  for ext in js css; do
    find "$SITE_DIR" -maxdepth 1 -type f \( -name "*.${ext}.br" -o -name "*.${ext}.gz" \) -delete 2>/dev/null || true
  done
}

strip_precompressed

PRECOMPRESS_OK=1
if command -v timeout >/dev/null 2>&1; then
  timeout 180 node "$SITE_DIR/scripts/precompress-assets.js" || PRECOMPRESS_OK=0
else
  node "$SITE_DIR/scripts/precompress-assets.js" || PRECOMPRESS_OK=0
fi

if [ "$PRECOMPRESS_OK" -ne 1 ]; then
  echo "[deploy] precompress failed or timed out; removing stale .br/.gz so nginx serves raw assets" >&2
  strip_precompressed
fi

if [ -f "$SITE_DIR/app.js" ]; then
  echo -n "[deploy] "
  head -n 1 "$SITE_DIR/app.js" || true
fi

if curl -fsS --max-time 8 "$HEALTH_URL"; then
  echo
else
  echo "warning: health check failed: $HEALTH_URL" >&2
fi

ASSET_V="$(sed -n "s/^const TP_ASSET_V = '\\([^']*\\)';/\\1/p" "$SITE_DIR/app.js" | head -n 1)"
if [ -z "$ASSET_V" ]; then
  echo "[deploy] could not read TP_ASSET_V from app.js" >&2
  exit 1
fi

FINANCE_PROBE="$(mktemp)"
cleanup_probe() { rm -f "$FINANCE_PROBE" "${FINANCE_PROBE}.dec" 2>/dev/null || true; }
trap cleanup_probe EXIT

if curl -fsS --max-time 25 -H 'Accept-Encoding: br' "${PUBLIC_ORIGIN}/app-finance.js?v=${ASSET_V}" -o "$FINANCE_PROBE"; then
  HITS=0
  if command -v brotli >/dev/null 2>&1; then
    brotli -d -f -o "${FINANCE_PROBE}.dec" "$FINANCE_PROBE" 2>/dev/null || cp -f "$FINANCE_PROBE" "${FINANCE_PROBE}.dec"
    HITS="$(grep -c 'setPartyTxPeriod' "${FINANCE_PROBE}.dec" 2>/dev/null || echo 0)"
  else
    HITS="$(grep -c 'setPartyTxPeriod' "$FINANCE_PROBE" 2>/dev/null || echo 0)"
  fi
  if [ "${HITS:-0}" -lt 1 ]; then
    echo "[deploy] live app-finance.js?v=${ASSET_V} missing setPartyTxPeriod (stale brotli/gzip or CDN cache)" >&2
    exit 1
  fi
  echo "[deploy] app-finance.js brotli probe ok (setPartyTxPeriod x${HITS})"
else
  echo "[deploy] warning: could not fetch ${PUBLIC_ORIGIN}/app-finance.js?v=${ASSET_V}" >&2
fi