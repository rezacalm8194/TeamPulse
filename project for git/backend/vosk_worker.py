#!/usr/bin/env python3
import json
import os
import sys
import time
import traceback
import wave


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def is_model_dir(path):
    return (
        path
        and os.path.isdir(path)
        and os.path.isdir(os.path.join(path, "conf"))
        and (
            os.path.isdir(os.path.join(path, "graph"))
            or os.path.isdir(os.path.join(path, "am"))
        )
    )


MODEL_PATH = os.environ.get("VOSK_MODEL_PATH") or os.path.join(
    os.path.dirname(__file__), "speech-models", "fa"
)

try:
    if not is_model_dir(MODEL_PATH):
        emit({
            "event": "error",
            "ready": False,
            "errorCode": "vosk_model_missing",
            "message": "Vosk Persian model is not installed",
            "voskInstalled": False,
            "modelLoaded": False,
            "modelPath": MODEL_PATH,
            "language": "fa",
        })
        sys.exit(2)

    try:
        import vosk
    except Exception as exc:
        emit({
            "event": "error",
            "ready": False,
            "errorCode": "vosk_engine_missing",
            "message": str(exc),
            "voskInstalled": False,
            "modelLoaded": False,
            "modelPath": MODEL_PATH,
            "language": "fa",
        })
        sys.exit(3)

    try:
        vosk.SetLogLevel(-1)
    except Exception:
        pass

    started = time.monotonic()
    model = vosk.Model(MODEL_PATH)
    model_load_time = round(time.monotonic() - started, 3)
    vosk_version = getattr(vosk, "__version__", None)
    emit({
        "event": "ready",
        "ready": True,
        "voskInstalled": True,
        "voskVersion": vosk_version,
        "modelLoaded": True,
        "modelPath": MODEL_PATH,
        "modelLoadTime": model_load_time,
        "language": "fa",
    })

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            request_id = request.get("id")
            wav_path = request.get("path")
            if request.get("action") != "transcribe" or not wav_path:
                emit({
                    "id": request_id,
                    "ok": False,
                    "errorCode": "invalid_request",
                    "message": "Invalid Vosk worker request",
                })
                continue

            with wave.open(wav_path, "rb") as wav_file:
                channels = wav_file.getnchannels()
                sample_rate = wav_file.getframerate()
                sample_width = wav_file.getsampwidth()
                if channels != 1 or sample_rate != 16000 or sample_width != 2:
                    emit({
                        "id": request_id,
                        "ok": False,
                        "errorCode": "audio_unprocessable",
                        "message": "WAV must be 16kHz mono 16-bit PCM",
                        "audio": {
                            "channels": channels,
                            "sampleRate": sample_rate,
                            "sampleWidth": sample_width,
                        },
                    })
                    continue

                recognizer = vosk.KaldiRecognizer(model, sample_rate)
                while True:
                    data = wav_file.readframes(4000)
                    if not data:
                        break
                    recognizer.AcceptWaveform(data)

            result = json.loads(recognizer.FinalResult() or "{}")
            text = (result.get("text") or "").strip()
            emit({
                "id": request_id,
                "ok": True,
                "text": text,
                "result": result,
                "engine": "python-vosk-worker",
            })
        except Exception as exc:
            emit({
                "id": locals().get("request_id", None),
                "ok": False,
                "errorCode": "vosk_worker_error",
                "message": str(exc),
                "trace": traceback.format_exc(),
            })
except Exception as exc:
    emit({
        "event": "error",
        "ready": False,
        "errorCode": "vosk_worker_error",
        "message": str(exc),
        "trace": traceback.format_exc(),
        "voskInstalled": False,
        "modelLoaded": False,
        "modelPath": MODEL_PATH,
        "language": "fa",
    })
    sys.exit(1)
