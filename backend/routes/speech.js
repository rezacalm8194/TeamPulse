const router = require('express').Router();
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const auth = require('../middleware/auth');

const DEBUG_AUDIO_DIR = path.join(__dirname, '..', '.speech-debug');
let lastDebugAudio = null;

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
    if (typeof fetch !== 'function' || typeof FormData === 'undefined' || typeof Blob === 'undefined') {
      return res.status(500).json({
        error: 'node_fetch_not_available',
        message: 'Server runtime must support fetch, FormData and Blob',
      });
    }

    const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
    await fsp.mkdir(DEBUG_AUDIO_DIR, { recursive: true });
    const id = randomUUID();
    const rawExt = audioExtension(req.file.originalname, req.file.mimetype);
    const rawFilename = `debug-${id}${rawExt}`;
    const rawPath = path.join(DEBUG_AUDIO_DIR, rawFilename);
    const convertedFilename = `debug-${id}.wav`;
    const convertedPath = path.join(DEBUG_AUDIO_DIR, convertedFilename);
    await fsp.writeFile(rawPath, req.file.buffer);

    const debug = {
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
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: 'speech_service_not_configured',
        message: 'OPENAI_API_KEY is not configured on the server',
        debug,
      });
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
      console.error('[speech] OpenAI transcription failed', {
        status: response.status,
        payload,
        file: {
          originalname: debug.backend.originalname,
          mimetype: debug.backend.mimetype,
          size: debug.backend.size,
          path: debug.backend.path,
          converted: debug.converted || null,
        },
      });
      const openAiMessage = payload.error?.message || 'Speech transcription failed';
      const isFormatError = /format|codec|mime|unsupported|invalid file/i.test(openAiMessage);
      return res.status(response.status).json({
        error: isFormatError ? 'unsupported_audio_format' : 'transcription_failed',
        message: process.env.NODE_ENV === 'production' ? 'Speech transcription failed' : openAiMessage,
        details: process.env.NODE_ENV === 'production' ? undefined : payload.error,
        debug,
      });
    }

    debug.transcription = { textLength: (payload.text || '').length };
    console.log('[speech] transcription completed', debug.transcription);
    res.json({ text: payload.text || '', debug });
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
