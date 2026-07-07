# TeamPulse Voice-to-Text Setup

TeamPulse uses this flow for paid-free server transcription:

```text
Browser MediaRecorder
  -> POST /api/speech/transcribe
  -> ffmpeg converts audio to WAV 16k mono
  -> Python Vosk worker
  -> Persian text
```

OpenAI is optional and is not used unless `SPEECH_PROVIDER=openai` is explicitly configured.

## Ubuntu 24.04

Run this once after deploy:

```bash
cd /home/pachim/TeamPulse.ir
bash scripts/install-vosk.sh
```

The installer:

- installs Python, pip, venv, ffmpeg, ffprobe, curl and unzip when `apt-get` is available
- creates `backend/.venv-speech`
- installs `vosk`, `soundfile` and `numpy`
- downloads the official Persian Vosk model
- extracts it into `backend/speech-models/fa`
- writes `SPEECH_PROVIDER=vosk`, `VOSK_MODEL_PATH` and `VOSK_PYTHON` into `backend/.env`

Restart the Node server after installation.

## Health Check

```bash
curl https://teampulse.ir/api/speech/health
```

Expected ready response:

```json
{
  "provider": "vosk",
  "ffmpeg": true,
  "ffprobe": true,
  "voskInstalled": true,
  "modelLoaded": true,
  "language": "fa",
  "ready": true
}
```

If `ready` is `false`, check `errorCode`:

- `vosk_model_missing`: Persian model is missing or extracted into the wrong folder.
- `vosk_engine_missing`: Python Vosk worker or Python environment is missing.
- `audio_tool_missing`: `ffmpeg` or `ffprobe` is missing.

## Environment

```env
SPEECH_PROVIDER=vosk
VOSK_MODEL_PATH=/home/pachim/TeamPulse.ir/backend/speech-models/fa
VOSK_PYTHON=/home/pachim/TeamPulse.ir/backend/.venv-speech/bin/python
```

To use another model URL during installation:

```bash
VOSK_MODEL_URL=https://alphacephei.com/vosk/models/YOUR_MODEL.zip bash scripts/install-vosk.sh
```
