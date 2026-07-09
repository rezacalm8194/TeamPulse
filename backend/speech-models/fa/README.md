# Vosk Persian Model

This directory is the runtime location for the Persian Vosk model.

Expected layout:

```text
backend/speech-models/fa/
  conf/
  graph/ or am/
  ...
```

Do not keep the downloaded model inside an extra nested folder. The installer handles this automatically.

Recommended setup on Ubuntu 24.04:

```bash
cd /home/pachim/TeamPulse.ir
bash scripts/install-vosk.sh
```

The installer downloads the official Persian model from the Vosk model list, extracts it here, installs the Python Vosk worker dependencies, and writes these values into `backend/.env`:

```env
SPEECH_PROVIDER=vosk
VOSK_MODEL_PATH=/home/pachim/TeamPulse.ir/backend/speech-models/fa
```

Python packages are installed only inside:

```text
backend/.venv/bin/python
```

Health check:

```bash
curl https://teampulse.ir/api/speech/health
```

Expected errors:

```json
{ "error": "vosk_model_missing" }
{ "error": "vosk_venv_missing" }
{ "error": "vosk_engine_missing" }
{ "error": "audio_tool_missing" }
```
