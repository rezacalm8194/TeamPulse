#!/usr/bin/env bash
# Post-git-pull steps for TeamPulse production (precompress, health, asset probe).
# Invoked by scripts/pachim-panel-deploy.sh (Pachim site deploy script) and at the
# end of scripts/pachim-deploy.sh (SSH one-click).

set -euo pipefail

SITE_DIR="${SITE_DIR:-/home/pachim/TeamPulse.ir}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://teampulse.ir}"

cd "$SITE_DIR"

strip_precompressed() {
  for ext in js css; do
    find "$SITE_DIR" -maxdepth 1 -type f \( -name "*.${ext}.br" -o -name "*.${ext}.gz" \) -delete 2>/dev/null || true
  done
}

echo "[deploy] post-pull: strip stale precompressed assets"
strip_precompressed

PRECOMPRESS_OK=1
echo "[deploy] post-pull: precompress assets"
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
  echo "[deploy] warning: health check failed: $HEALTH_URL" >&2
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

echo "[deploy] post-pull done"