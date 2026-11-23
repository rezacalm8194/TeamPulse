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

FINANCE_URL="${PUBLIC_ORIGIN}/app-finance.js?v=${ASSET_V}"
PROBE_TMP="$(mktemp)"
cleanup_probe() { rm -f "$PROBE_TMP" "${PROBE_TMP}."* 2>/dev/null || true; }
trap cleanup_probe EXIT

grep_symbol_hits() {
  local file="$1"
  local hits
  hits="$(grep -c 'setPartyTxPeriod' "$file" 2>/dev/null || true)"
  hits="${hits:-0}"
  hits="$(printf '%s' "$hits" | tr -cd '0-9')"
  printf '%s' "${hits:-0}"
}

probe_finance_encoding() {
  local label="$1"
  local accept="$2"
  local raw="${PROBE_TMP}.${label}"
  local decoded="${PROBE_TMP}.${label}.js"

  if ! curl -fsS --max-time 25 -H "Accept-Encoding: ${accept}" "$FINANCE_URL" -o "$raw"; then
    echo "[deploy] could not fetch app-finance.js (${label})" >&2
    return 1
  fi

  case "$label" in
    identity)
      cp -f "$raw" "$decoded"
      ;;
    gzip)
      if ! gunzip -c "$raw" > "$decoded" 2>/dev/null; then
        echo "[deploy] gunzip failed for app-finance.js (${label})" >&2
        return 1
      fi
      ;;
    br)
      if ! command -v brotli >/dev/null 2>&1; then
        return 0
      fi
      if ! brotli -d -f -o "$decoded" "$raw" 2>/dev/null; then
        echo "[deploy] brotli decode failed for app-finance.js (${label})" >&2
        return 1
      fi
      ;;
    *)
      echo "[deploy] unknown probe label: ${label}" >&2
      return 1
      ;;
  esac

  local hits
  hits="$(grep_symbol_hits "$decoded")"
  if [ "$hits" -lt 1 ]; then
    echo "[deploy] app-finance.js?v=${ASSET_V} (${label}) missing setPartyTxPeriod" >&2
    return 1
  fi
  echo "[deploy] app-finance.js ${label} probe ok (setPartyTxPeriod x${hits})"
  return 0
}

PROBE_FAIL=0
probe_finance_encoding identity identity || PROBE_FAIL=1
probe_finance_encoding gzip gzip || PROBE_FAIL=1
if command -v brotli >/dev/null 2>&1; then
  probe_finance_encoding br br || PROBE_FAIL=1
fi
if [ "$PROBE_FAIL" -ne 0 ]; then
  echo "[deploy] app-finance.js live probe failed (stale .br/.gz or CDN cache?)" >&2
  exit 1
fi

echo "[deploy] post-pull done"