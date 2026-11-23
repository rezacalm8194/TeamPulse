#!/usr/bin/env bash
# Optional entrypoint if the host runs ./deploy.sh after git pull (same as Pachim panel hook).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export SITE_DIR="$ROOT"
export HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
export PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://teampulse.ir}"
exec bash "$ROOT/scripts/pachim-post-pull.sh"