#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
MODEL_DIR="${VOSK_MODEL_PATH:-$BACKEND_DIR/speech-models/fa}"
VENV_DIR="${VOSK_VENV_DIR:-$BACKEND_DIR/.venv-speech}"
PYTHON_BIN="$VENV_DIR/bin/python"
MODEL_LIST_URL="https://alphacephei.com/vosk/models/model-list.json"
SUDO="sudo"
if [ "${EUID:-$(id -u)}" -eq 0 ] || ! command -v sudo >/dev/null 2>&1; then
  SUDO=""
fi

log() {
  printf '[install-vosk] %s\n' "$*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

if need_cmd apt-get; then
  log "Installing system packages"
  $SUDO apt-get update
  $SUDO apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    unzip \
    ca-certificates
else
  log "apt-get not found; assuming Python, pip, ffmpeg, curl and unzip are already installed"
fi

if ! need_cmd ffmpeg || ! need_cmd ffprobe; then
  echo "audio_tool_missing: ffmpeg/ffprobe is not installed" >&2
  exit 20
fi

log "Creating Python virtual environment at $VENV_DIR"
python3 -m venv "$VENV_DIR"
"$PYTHON_BIN" -m pip install --upgrade pip wheel setuptools
"$PYTHON_BIN" -m pip install --upgrade vosk soundfile numpy

mkdir -p "$MODEL_DIR"
if [ ! -d "$MODEL_DIR/conf" ]; then
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  MODEL_ZIP="$TMP_DIR/vosk-fa.zip"

  if [ -n "${VOSK_MODEL_URL:-}" ]; then
    MODEL_URL="$VOSK_MODEL_URL"
  else
    log "Finding official Persian Vosk model"
    MODEL_URL="$("$PYTHON_BIN" - "$MODEL_LIST_URL" <<'PY'
import json
import sys
import urllib.request
import urllib.parse

url = sys.argv[1]
with urllib.request.urlopen(url, timeout=45) as response:
    models = json.load(response)
if isinstance(models, dict):
    models = models.get("models") or list(models.values())

def is_persian(item):
    fields = " ".join(str(item.get(k, "")) for k in ("lang", "lang_text", "name", "url")).lower()
    return (
        item.get("lang") == "fa"
        or "persian" in fields
        or "farsi" in fields
        or "small-fa" in fields
        or "-fa-" in fields
    )

candidates = [m for m in models if is_persian(m) and not m.get("obsolete")]
small = [m for m in candidates if "small" in str(m.get("name", "")).lower()]
chosen = (small or candidates)[0] if (small or candidates) else None
if not chosen:
    raise SystemExit("vosk_model_missing: Persian model was not found in official model list")
model_url = chosen.get("url")
if not model_url:
    raise SystemExit("vosk_model_missing: Persian model URL was empty")
print(urllib.parse.urljoin(url, model_url))
PY
)"
  fi

  if [ -z "$MODEL_URL" ]; then
    echo "vosk_model_missing: Persian Vosk model download URL was not found" >&2
    exit 30
  fi

  log "Downloading Persian Vosk model from $MODEL_URL"
  if ! curl -L --fail --retry 3 --retry-delay 3 -o "$MODEL_ZIP" "$MODEL_URL"; then
    echo "vosk_model_missing: Persian Vosk model could not be downloaded" >&2
    exit 33
  fi
  log "Extracting model"
  unzip -q "$MODEL_ZIP" -d "$TMP_DIR/model"
  EXTRACTED_MODEL="$(find "$TMP_DIR/model" -type d -name conf -print -quit | xargs -r dirname)"
  if [ -z "$EXTRACTED_MODEL" ] || [ ! -d "$EXTRACTED_MODEL/conf" ]; then
    echo "vosk_model_missing: downloaded archive did not contain a valid Vosk model" >&2
    exit 31
  fi
  rm -rf "$MODEL_DIR"
  mkdir -p "$MODEL_DIR"
  cp -a "$EXTRACTED_MODEL"/. "$MODEL_DIR"/
fi

if [ ! -d "$MODEL_DIR/conf" ]; then
  echo "vosk_model_missing: $MODEL_DIR is not a valid Vosk model directory" >&2
  exit 32
fi

ENV_FILE="$BACKEND_DIR/.env"
touch "$ENV_FILE"
if grep -q '^SPEECH_PROVIDER=' "$ENV_FILE"; then
  sed -i 's|^SPEECH_PROVIDER=.*|SPEECH_PROVIDER=vosk|' "$ENV_FILE"
else
  printf '\nSPEECH_PROVIDER=vosk\n' >> "$ENV_FILE"
fi
if grep -q '^VOSK_MODEL_PATH=' "$ENV_FILE"; then
  sed -i "s|^VOSK_MODEL_PATH=.*|VOSK_MODEL_PATH=$MODEL_DIR|" "$ENV_FILE"
else
  printf 'VOSK_MODEL_PATH=%s\n' "$MODEL_DIR" >> "$ENV_FILE"
fi
if grep -q '^VOSK_PYTHON=' "$ENV_FILE"; then
  sed -i "s|^VOSK_PYTHON=.*|VOSK_PYTHON=$PYTHON_BIN|" "$ENV_FILE"
else
  printf 'VOSK_PYTHON=%s\n' "$PYTHON_BIN" >> "$ENV_FILE"
fi

log "Checking Vosk import and model path"
"$PYTHON_BIN" - "$MODEL_DIR" <<'PY'
import os
import sys
import vosk

model_path = sys.argv[1]
if not os.path.isdir(os.path.join(model_path, "conf")):
    raise SystemExit("vosk_model_missing")
print("vosk_engine_ready")
print("voskVersion=" + str(getattr(vosk, "__version__", "unknown")))
print("modelPath=" + model_path)
PY

log "Done. Restart the Node server, then check: GET /api/speech/health"
