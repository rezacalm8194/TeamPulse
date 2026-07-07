# Vosk Persian speech model

Place the extracted Persian Vosk model files in this directory.

Expected path:

```text
backend/speech-models/fa/
```

This folder must contain the model files directly, not another nested wrapper folder.
For example, files and folders such as `am`, `conf`, `graph`, and `ivector` should be inside `fa`.

Suggested setup on the server:

```bash
cd backend
npm install
npm install vosk
# Download a Persian model from https://alphacephei.com/vosk/models
# Extract it into backend/speech-models/fa
```

Runtime requirements:

```bash
ffmpeg
ffprobe
SPEECH_PROVIDER=vosk
```

If the model is missing, the API returns:

```json
{ "error": "vosk_model_missing" }
```
