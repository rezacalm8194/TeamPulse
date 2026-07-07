const router = require('express').Router();
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const auth = require('../middleware/auth');

const DEBUG_AUDIO_DIR = path.join(__dirname, '..', '.speech-debug');
const VOSK_MODEL_DIR = path.join(__dirname, '..', 'speech-models', 'fa');
let lastDebugAudio = null;
let cachedVoskModel = null;
let cachedVosk = null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('audio/')) {
      return cb(new Error('audio file required'));
    }
    cb(null, true);
  },
});

function isDevelopment() {
  return process.env.NODE_ENV !== 'production';
}

function audioExtension(filename, mimetype) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext) return ext;
  if ((mimetype || '').includes('mp4')) return '.m4a';
  if ((mimetype || '').includes('webm')) return '.webm';
  if ((mimetype || '').includes('wav')) return '.wav';
  if ((mimetype || '').includes('mpeg')) return '.mp3';
  return '.audio';
}

function runTool(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      err.stderr = stderr;
      reject(err);
    });
    child.on('close', code => {
      if (code === 0) return resolve({ stdout, stderr });
      const err = new Error(`${command} exited with code ${code}`);
      err.code = code;
      err.stderr = stderr;
      reject(err);
    });
  });
}

async function probeAudio(filePath) {
  const { stdout } = await runTool('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ]);
  const info = JSON.parse(stdout || '{}');
  const stream = (info.streams || []).find(s => s.codec_type === 'audio') || {};
  const duration = Number.parseFloat(stream.duration || info.format?.duration || '0') || 0;
  return {
    duration,
    codec: stream.codec_name || null,
    sample_rate: stream.sample_rate ? Number.parseInt(stream.sample_rate, 10) : null,
    channels: stream.channels || null,
  };
}

async function convertToWav(inputPath, outputPath) {
  await runTool('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    outputPath,
  ]);
}

function speechProvider() {
  return (process.env.SPEECH_PROVIDER || 'vosk').trim().toLowerCase();
}

function isVoskModelDirectory(dir) {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
    const hasConf = fs.existsSync(path.join(dir, 'conf'));
    const hasGraph = fs.existsSync(path.join(dir, 'graph'));
    const hasAm = fs.existsSync(path.join(dir, 'am'));
    return hasConf && (hasGraph || hasAm);
  } catch {
    return false;
  }
}

function extractPcmFromWav(buffer) {
  if (!buffer || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('invalid wav file');
  }
  let offset = 12;
  let audioFormat = null;
  let sampleRate = null;
  let channels = null;
  let bitsPerSample = null;
  let dataStart = null;
  let dataSize = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === 'fmt ') {
      audioFormat = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    } else if (chunkId === 'data') {
      dataStart = chunkStart;
      dataSize = chunkSize;
      break;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (dataStart == null || !dataSize) throw new Error('wav data chunk missing');
  return {
    pcm: buffer.subarray(dataStart, Math.min(dataStart + dataSize, buffer.length)),
    format: { audioFormat, channels, sampleRate, bitsPerSample },
  };
}

function loadVoskModel(debug) {
  debug.vosk = debug.vosk || {};
  debug.vosk.modelPath = VOSK_MODEL_DIR;
  debug.vosk.modelExists = isVoskModelDirectory(VOSK_MODEL_DIR);
  debug.voskModelLoaded = false;
  if (!debug.vosk.modelExists) {
    const err = new Error('Vosk Persian model is not installed');
    err.code = 'vosk_model_missing';
    throw err;
  }
  if (!cachedVosk) {
    try {
      cachedVosk = require('vosk');
      if (typeof cachedVosk.setLogLevel === 'function') cachedVosk.setLogLevel(0);
      debug.vosk.packageLoaded = true;
    } catch (e) {
      debug.vosk.packageLoaded = false;
      const err = new Error('Vosk package is not installed');
      err.code = 'vosk_engine_missing';
      throw err;
    }
  } else {
    debug.vosk.packageLoaded = true;
  }
  if (!cachedVoskModel) cachedVoskModel = new cachedVosk.Model(VOSK_MODEL_DIR);
  debug.vosk.modelLoaded = true;
  debug.voskModelLoaded = true;
  return { vosk: cachedVosk, model: cachedVoskModel };
}

async function transcribeWithVosk(convertedPath, debug) {
  debug.speechProvider = 'vosk';
  debug.transcriptionEngine = 'vosk';
  const { vosk, model } = loadVoskModel(debug);
  const wavBuffer = await fsp.readFile(convertedPath);
  const wav = extractPcmFromWav(wavBuffer);
  debug.vosk.wav = wav.format;
  if (wav.format.sampleRate !== 16000 || wav.format.channels !== 1 || wav.format.bitsPerSample !== 16) {
    const err = new Error('Converted wav must be 16kHz mono 16-bit PCM');
    err.code = 'audio_unprocessable';
    throw err;
  }
  const recognizer = new vosk.Recognizer({ model, sampleRate: 16000 });
  try {
    recognizer.acceptWaveform(wav.pcm);
    const rawResult = recognizer.finalResult() || {};
    const result = typeof rawResult === 'string' ? JSON.parse(rawResult || '{}') : rawResult;
    const text = (result.text || '').trim();
    debug.vosk.result = result;
    return text;
  } finally {
    if (typeof recognizer.free === 'function') recognizer.free();
  }
}

async function transcribeWithOpenAI(convertedBuffer, model, debug) {
  debug.speechProvider = 'openai';
  debug.transcriptionEngine = 'openai';
  if (typeof fetch !== 'function' || typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    const err = new Error('Server runtime must support fetch, FormData and Blob');
    err.code = 'node_fetch_not_available';
    throw err;
  }
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY is not configured on the server');
    err.code = 'speech_service_not_configured';
    throw err;
  }
  const form = new FormData();
  form.append('model', model);
  form.append('language', 'fa');
  form.append('prompt', 'این فایل شامل گفتار فارسی است. متن را دقیق و روان به فارسی پیاده‌سازی کن.');
  form.append('file', new Blob([convertedBuffer], { type: 'audio/wav' }), 'converted.wav');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const openAiError = payload.error || {};
    const openAiMessage = openAiError.message || 'Speech transcription failed';
    debug.openai = {
      status: response.status,
      type: openAiError.type || null,
      code: openAiError.code || null,
      message: openAiMessage,
    };
    const err = new Error(openAiMessage);
    err.provider = 'openai';
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return (payload.text || '').trim();
}

router.get('/debug-last-audio', async (req, res) => {
  if (!isDevelopment()) {
    return res.status(404).json({ error: 'not_found' });
  }
  const type = req.query.type === 'converted' ? 'converted' : 'raw';
  const item = lastDebugAudio && lastDebugAudio[type];
  if (!item || !fs.existsSync(item.path)) {
    return res.status(404).json({ error: 'debug_audio_not_found' });
  }
  res.download(item.path, item.filename);
});

router.get('/ping', (req, res) => {
  console.log('[speech-ping]', new Date().toISOString(), {
    method: req.method,
    url: req.originalUrl,
  });
  res.json({ ok: true, route: 'speech', time: new Date().toISOString() });
});

function speechRouteHit(req, res, next) {
  console.log('speech route hit');
  console.log('[speech-route-hit]', new Date().toISOString(), {
    method: req.method,
    url: req.originalUrl,
    contentType: req.headers['content-type'] || null,
    contentLength: req.headers['content-length'] || null,
  });
  next();
}

function handleSpeechUpload(req, res, next) {
  upload.single('audio')(req, res, err => {
    if (!err) return next();
    console.error('[speech-upload-error]', err);
    const isSize = err.code === 'LIMIT_FILE_SIZE';
    return res.status(isSize ? 413 : 400).json({
      error: isSize ? 'audio_too_large' : 'audio_upload_failed',
      message: err.message || 'audio upload failed',
      debug: {
        backend: {
          mimetype: null,
          size: null,
          uploadError: err.code || err.message || 'upload_failed',
        },
      },
    });
  });
}

router.post('/transcribe', speechRouteHit, auth, handleSpeechUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'audio_required', message: 'audio file required' });
    }

    const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
    const provider = speechProvider();
    await fsp.mkdir(DEBUG_AUDIO_DIR, { recursive: true });
    const id = randomUUID();
    const rawExt = audioExtension(req.file.originalname, req.file.mimetype);
    const rawFilename = `debug-${id}${rawExt}`;
    const rawPath = path.join(DEBUG_AUDIO_DIR, rawFilename);
    const convertedFilename = `debug-${id}.wav`;
    const convertedPath = path.join(DEBUG_AUDIO_DIR, convertedFilename);
    await fsp.writeFile(rawPath, req.file.buffer);

    const debug = {
      speechProvider: provider,
      transcriptionEngine: null,
      voskModelLoaded: false,
      backend: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: rawPath,
      },
    };
    lastDebugAudio = {
      raw: {
        path: rawPath,
        filename: req.file.originalname || rawFilename,
        mimetype: req.file.mimetype || 'application/octet-stream',
      },
      converted: null,
      createdAt: new Date().toISOString(),
    };
    console.log('[speech] received audio', {
      originalname: debug.backend.originalname,
      mimetype: debug.backend.mimetype,
      size: debug.backend.size,
      path: debug.backend.path,
    });

    let probe;
    try {
      probe = await probeAudio(rawPath);
      debug.probe = probe;
      console.log('[speech] ffprobe audio', probe);
    } catch (e) {
      console.error('[speech] ffprobe failed', e);
      const isToolMissing = e.code === 'ENOENT';
      return res.status(isToolMissing ? 503 : 422).json({
        error: isToolMissing ? 'audio_tool_missing' : 'audio_unprocessable',
        message: isToolMissing ? 'ffprobe is not installed on the server' : 'فایل صوتی قابل پردازش نیست.',
        debug,
      });
    }

    if (!probe.duration || !probe.codec) {
      return res.status(422).json({
        error: 'audio_unprocessable',
        message: 'فایل صوتی قابل پردازش نیست.',
        debug,
      });
    }

    try {
      await convertToWav(rawPath, convertedPath);
      const convertedStats = await fsp.stat(convertedPath);
      debug.converted = {
        filename: convertedFilename,
        mimetype: 'audio/wav',
        size: convertedStats.size,
        path: convertedPath,
      };
      if (!convertedStats.size) {
        return res.status(422).json({
          error: 'audio_unprocessable',
          message: 'فایل صوتی قابل پردازش نیست.',
          debug,
        });
      }
      lastDebugAudio.converted = {
        path: convertedPath,
        filename: convertedFilename,
        mimetype: 'audio/wav',
      };
      console.log('[speech] converted audio', debug.converted);
    } catch (e) {
      console.error('[speech] ffmpeg conversion failed', e);
      const isToolMissing = e.code === 'ENOENT';
      return res.status(isToolMissing ? 503 : 422).json({
        error: isToolMissing ? 'audio_tool_missing' : 'audio_unprocessable',
        message: isToolMissing ? 'ffmpeg is not installed on the server' : 'فایل صوتی قابل پردازش نیست.',
        debug,
      });
    }

    const convertedBuffer = await fsp.readFile(convertedPath);
    let text = '';
    try {
      if (provider === 'openai') {
        text = await transcribeWithOpenAI(convertedBuffer, model, debug);
      } else if (provider === 'vosk' || provider === 'webspeech') {
        text = await transcribeWithVosk(convertedPath, debug);
      } else if (provider === 'deepgram') {
        return res.status(501).json({
          error: 'speech_provider_not_implemented',
          message: 'این provider هنوز پیاده‌سازی نشده است.',
          debug,
        });
      } else {
        return res.status(400).json({
          error: 'speech_provider_invalid',
          message: 'SPEECH_PROVIDER معتبر نیست.',
          debug,
        });
      }
    } catch (e) {
      if (e.provider === 'openai') {
        console.error('[speech] OpenAI transcription failed', {
          status: e.status,
          payload: e.payload,
          openai: debug.openai,
          file: {
            originalname: debug.backend.originalname,
            mimetype: debug.backend.mimetype,
            size: debug.backend.size,
            path: debug.backend.path,
            converted: debug.converted || null,
          },
        });
        let errorCode = 'transcription_failed';
        let message = process.env.NODE_ENV === 'production' ? 'Speech transcription failed' : e.message;
        if (e.status === 429) {
          errorCode = 'openai_rate_limit_or_quota';
          message = 'محدودیت مصرف یا اعتبار OpenAI API فعال شده است.';
        } else if (e.status === 401) {
          errorCode = 'openai_auth_failed';
        } else if (e.status === 403) {
          errorCode = 'openai_permission_denied';
        } else if (e.status >= 500) {
          errorCode = 'openai_server_error';
        } else if (e.status === 400 && /format|codec|mime|unsupported|invalid file/i.test(e.message || '')) {
          errorCode = 'unsupported_audio_format';
        }
        return res.status(e.status || 500).json({
          error: errorCode,
          message,
          details: process.env.NODE_ENV === 'production' ? undefined : (e.payload?.error || null),
          debug,
        });
      }
      if (e.code === 'node_fetch_not_available') {
        return res.status(500).json({
          error: 'node_fetch_not_available',
          message: 'Server runtime must support fetch, FormData and Blob',
          debug,
        });
      }
      if (e.code === 'vosk_model_missing') {
        return res.status(503).json({
          error: 'vosk_model_missing',
          message: 'مدل تبدیل صدای فارسی روی سرور نصب نشده',
          debug,
        });
      }
      if (e.code === 'vosk_engine_missing') {
        return res.status(503).json({
          error: 'vosk_engine_missing',
          message: 'موتور Vosk روی سرور نصب نشده است.',
          debug,
        });
      }
      if (e.code === 'audio_unprocessable') {
        return res.status(422).json({
          error: 'audio_unprocessable',
          message: 'فایل صوتی قابل پردازش نیست.',
          debug,
        });
      }
      throw e;
    }

    if (!text) {
      debug.transcription = { textLength: 0 };
      return res.status(422).json({
        error: 'empty_transcription',
        message: 'صدای کافی تشخیص داده نشد',
        debug,
      });
    }

    debug.transcription = { textLength: text.length };
    console.log('[speech] transcription completed', debug.transcription);
    res.json({ text, debug });
  } catch (e) {
    const msg = e && e.message ? e.message : 'speech transcription error';
    console.error('[speech] transcription route error', e);
    if (msg.includes('audio file required')) {
      return res.status(400).json({ error: 'audio_required', message: 'audio file required' });
    }
    res.status(500).json({ error: 'speech_error', message: msg });
  }
});

module.exports = router;
