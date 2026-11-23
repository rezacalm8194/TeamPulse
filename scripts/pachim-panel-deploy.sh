#!/usr/bin/env bash
# Pachim site deploy script for teampulse.ir (paste into panel or sync via update_deploy_script).

set -euo pipefail

cd "$RELEASE"
git pull origin "$PACHIM_SITE_BRANCH"

export SITE_DIR="$RELEASE"
export HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
export PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://teampulse.ir}"

bash "$RELEASE/scripts/pachim-post-pull.sh"