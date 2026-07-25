const router = require('express').Router();
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const auth = require('../middleware/auth');

const DEBUG_AUDIO_DIR = path.join(__dirname, '..', '.speech-debug');
const VOSK_MODEL_DIR = process.env.VOSK_MODEL_PATH || path.join(__dirname, '..', 'speech-models', 'fa');
const VOSK_WORKER_PATH = path.join(__dirname, '..', 'vosk_worker.py');
const VOSK_PYTHON = path.join(__dirname, '..', '.venv', 'bin', 'python');
let lastDebugAudio = null;
let voskWorker = null;
let voskWorkerSeq = 0;
const voskWorkerState = {
  started: false,
  ready: false,
  initializing: false,
  pendingReady: null,
  errorCode: null,
  errorMessage: null,
  venvExists: fs.existsSync(VOSK_PYTHON),
  pythonPath: VOSK_PYTHON,
  voskInstalled: false,
  voskVersion: null,
  modelLoaded: false,
  modelPath: VOSK_MODEL_DIR,
  modelLoadTime: null,
  language: 'fa',
  pending: new Map(),
  stdoutBuffer: '',
};

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

function responseDebug(debug) {
  return isDevelopment() ? debug : undefined;
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

async function toolAvailable(command) {
  try {
    await runTool(command, ['-version']);
    return true;
  } catch {
    return false;
  }
}

async function pythonPackageAvailable(packageName) {
  if (!fs.existsSync(VOSK_PYTHON)) return false;
  try {
    await runTool(VOSK_PYTHON, ['-c', `import ${packageName}`]);
    return true;
  } catch {
    return false;
  }
}

function speechProvider() {
  return (process.env.SPEECH_PROVIDER || 'vosk').trim().toLowerCase();
}

function pythonCommand() {
  return VOSK_PYTHON;
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

function applyVoskWorkerInfo(info) {
  if (!info) return;
  voskWorkerState.errorCode = info.errorCode || null;
  voskWorkerState.errorMessage = info.message || null;
  voskWorkerState.venvExists = fs.existsSync(VOSK_PYTHON);
  voskWorkerState.pythonPath = VOSK_PYTHON;
  voskWorkerState.voskInstalled = !!info.voskInstalled;
  voskWorkerState.voskVersion = info.voskVersion || null;
  voskWorkerState.modelLoaded = !!info.modelLoaded;
  voskWorkerState.modelPath = info.modelPath || VOSK_MODEL_DIR;
  voskWorkerState.modelLoadTime = info.modelLoadTime || null;
  voskWorkerState.language = info.language || 'fa';
  voskWorkerState.ready = !!info.ready;
}

function rejectPendingVoskRequests(err) {
  for (const item of voskWorkerState.pending.values()) {
    item.reject(err);
  }
  voskWorkerState.pending.clear();
}

function handleVoskWorkerLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    console.warn('[speech-vosk-worker] non-json output', line);
    return;
  }
  if (msg.event === 'ready') {
    applyVoskWorkerInfo(msg);
    voskWorkerState.started = true;
    voskWorkerState.initializing = false;
    if (voskWorkerState.pendingReady) {
      voskWorkerState.pendingReady.resolve(voskHealthSnapshot());
      voskWorkerState.pendingReady = null;
    }
    return;
  }
  if (msg.event === 'error') {
    applyVoskWorkerInfo(msg);
    voskWorkerState.initializing = false;
    const err = new Error(msg.message || 'Vosk worker failed');
    err.code = msg.errorCode || 'vosk_engine_missing';
    if (voskWorkerState.pendingReady) {
      voskWorkerState.pendingReady.reject(err);
      voskWorkerState.pendingReady = null;
    }
    rejectPendingVoskRequests(err);
    return;
  }
  if (msg.id && voskWorkerState.pending.has(msg.id)) {
    const item = voskWorkerState.pending.get(msg.id);
    voskWorkerState.pending.delete(msg.id);
    if (msg.ok) item.resolve(msg);
    else {
      const err = new Error(msg.message || 'Vosk transcription failed');
      err.code = msg.errorCode || 'transcription_failed';
      item.reject(err);
    }
  }
}

function startVoskWorker() {
  if (voskWorker && !voskWorker.killed && voskWorkerState.ready) {
    return Promise.resolve(voskHealthSnapshot());
  }
  if (voskWorkerState.initializing && voskWorkerState.pendingReady) {
    return voskWorkerState.pendingReady.promise;
  }
  voskWorkerState.venvExists = fs.existsSync(VOSK_PYTHON);
  voskWorkerState.pythonPath = VOSK_PYTHON;
  if (!voskWorkerState.venvExists) {
    voskWorkerState.ready = false;
    voskWorkerState.voskInstalled = false;
    voskWorkerState.errorCode = 'vosk_venv_missing';
    voskWorkerState.errorMessage = `Python virtual environment was not found at ${VOSK_PYTHON}`;
    const err = new Error(voskWorkerState.errorMessage);
    err.code = 'vosk_venv_missing';
    return Promise.reject(err);
  }
  if (!isVoskModelDirectory(VOSK_MODEL_DIR)) {
    voskWorkerState.ready = false;
    voskWorkerState.modelLoaded = false;
    voskWorkerState.modelPath = VOSK_MODEL_DIR;
    voskWorkerState.errorCode = 'vosk_model_missing';
    voskWorkerState.errorMessage = 'Vosk Persian model is not installed';
    const err = new Error(voskWorkerState.errorMessage);
    err.code = 'vosk_model_missing';
    return Promise.reject(err);
  }
  const py = pythonCommand();
  voskWorkerState.initializing = true;
  voskWorkerState.ready = false;
  voskWorkerState.errorCode = null;
  voskWorkerState.errorMessage = null;
  voskWorkerState.stdoutBuffer = '';
  const pendingReady = {};
  pendingReady.promise = new Promise((resolve, reject) => {
    pendingReady.resolve = resolve;
    pendingReady.reject = reject;
  });
  voskWorkerState.pendingReady = pendingReady;
  voskWorker = spawn(py, [VOSK_WORKER_PATH], {
    cwd: path.join(__dirname, '..'),
    windowsHide: true,
    env: {
      ...process.env,
      VOSK_MODEL_PATH: VOSK_MODEL_DIR,
      PYTHONUNBUFFERED: '1',
    },
  });
  voskWorker.stdout.on('data', chunk => {
    voskWorkerState.stdoutBuffer += chunk.toString();
    const lines = voskWorkerState.stdoutBuffer.split(/\r?\n/);
    voskWorkerState.stdoutBuffer = lines.pop() || '';
    lines.filter(Boolean).forEach(handleVoskWorkerLine);
  });
  voskWorker.stderr.on('data', chunk => {
    console.error('[speech-vosk-worker]', chunk.toString().trim());
  });
  voskWorker.on('error', err => {
    voskWorkerState.initializing = false;
    voskWorkerState.ready = false;
    voskWorkerState.venvExists = fs.existsSync(VOSK_PYTHON);
    voskWorkerState.voskInstalled = false;
    voskWorkerState.errorCode = err.code === 'ENOENT' ? 'vosk_venv_missing' : 'vosk_worker_error';
    voskWorkerState.errorMessage = err.message;
    err.code = voskWorkerState.errorCode;
    if (voskWorkerState.pendingReady) {
      voskWorkerState.pendingReady.reject(err);
      voskWorkerState.pendingReady = null;
    }
    rejectPendingVoskRequests(err);
  });
  voskWorker.on('exit', code => {
    voskWorkerState.started = false;
    voskWorkerState.initializing = false;
    voskWorkerState.ready = false;
    voskWorkerState.errorCode = voskWorkerState.errorCode || 'vosk_worker_exited';
    voskWorkerState.errorMessage = voskWorkerState.errorMessage || `Vosk worker exited with code ${code}`;
    const err = new Error(voskWorkerState.errorMessage);
    err.code = voskWorkerState.errorCode;
    if (voskWorkerState.pendingReady) {
      voskWorkerState.pendingReady.reject(err);
      voskWorkerState.pendingReady = null;
    }
    rejectPendingVoskRequests(err);
  });
  return pendingReady.promise;
}

async function ensureVoskReady() {
  if (voskWorkerState.ready && voskWorker && !voskWorker.killed) return voskHealthSnapshot();
  return startVoskWorker();
}

function voskHealthSnapshot() {
  return {
    venvExists: fs.existsSync(VOSK_PYTHON),
    pythonPath: VOSK_PYTHON,
    voskInstalled: voskWorkerState.voskInstalled,
    voskVersion: voskWorkerState.voskVersion,
    modelLoaded: voskWorkerState.modelLoaded,
    modelPath: voskWorkerState.modelPath,
    modelLoadTime: voskWorkerState.modelLoadTime,
    language: voskWorkerState.language,
    errorCode: voskWorkerState.errorCode,
    errorMessage: voskWorkerState.errorMessage,
  };
}

async function transcribeWithVosk(convertedPath, debug) {
  debug.speechProvider = 'vosk';
  debug.transcriptionEngine = 'python-vosk-worker';
  const health = await ensureVoskReady();
  debug.vosk = { ...health };
  debug.voskVersion = health.voskVersion;
  debug.modelLoaded = health.modelLoaded;
  debug.modelPath = health.modelPath;
  debug.modelLoadTime = health.modelLoadTime;
  debug.voskModelLoaded = health.modelLoaded;
  const id = `req-${++voskWorkerSeq}`;
  const response = await new Promise((resolve, reject) => {
    voskWorkerState.pending.set(id, { resolve, reject });
    voskWorker.stdin.write(JSON.stringify({ id, action: 'transcribe', path: convertedPath }) + '\n', err => {
      if (err) {
        voskWorkerState.pending.delete(id);
        err.code = 'vosk_worker_write_failed';
        reject(err);
      }
    });
  });
  debug.vosk.result = response.result || null;
  return (response.text || '').trim();
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
    debug.openaiStatus = response.status;
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
  if (isDevelopment()) {
    console.log('[speech-ping]', new Date().toISOString(), {
      method: req.method,
      url: req.originalUrl,
    });
  }
  res.json({ ok: true, route: 'speech', time: new Date().toISOString() });
});

router.get('/health', async (req, res) => {
  const provider = speechProvider();
  if (provider === 'vosk' && !voskWorkerState.ready && !voskWorkerState.initializing) {
    startVoskWorker().catch(err => {
      console.warn('[speech-health] vosk warmup failed', err.code || err.message);
    });
  }
  const [ffmpeg, ffprobe] = await Promise.all([
    toolAvailable('ffmpeg'),
    toolAvailable('ffprobe'),
  ]);
  const venvExists = fs.existsSync(VOSK_PYTHON);
  const voskInstalled = venvExists ? await pythonPackageAvailable('vosk') : false;
  if (venvExists && !voskInstalled && !voskWorkerState.errorCode) {
    voskWorkerState.errorCode = 'vosk_engine_missing';
    voskWorkerState.errorMessage = 'Vosk is not installed inside backend/.venv';
  }
  const modelExists = isVoskModelDirectory(VOSK_MODEL_DIR);
  const ready = provider === 'vosk'
    ? !!(ffmpeg && ffprobe && venvExists && voskInstalled && voskWorkerState.modelLoaded && voskWorkerState.ready)
    : true;
  res.json({
    provider,
    ffmpeg,
    ffprobe,
    venvExists,
    pythonPath: responseDebug(VOSK_PYTHON),
    voskInstalled,
    voskVersion: voskWorkerState.voskVersion,
    modelLoaded: voskWorkerState.modelLoaded,
    modelExists,
    modelPath: responseDebug(voskWorkerState.modelPath || VOSK_MODEL_DIR),
    modelLoadTime: voskWorkerState.modelLoadTime,
    language: voskWorkerState.language || 'fa',
    errorCode: !venvExists ? 'vosk_venv_missing' : (!voskInstalled ? 'vosk_engine_missing' : voskWorkerState.errorCode),
    errorMessage: responseDebug(!venvExists ? `Python virtual environment was not found at ${VOSK_PYTHON}` : (!voskInstalled ? 'Vosk is not installed inside backend/.venv' : voskWorkerState.errorMessage)),
    ready,
  });
});

function speechRouteHit(req, res, next) {
  if (isDevelopment()) {
    console.log('[speech-route-hit]', new Date().toISOString(), {
      method: req.method,
      url: req.originalUrl,
      contentType: req.headers['content-type'] || null,
      contentLength: req.headers['content-length'] || null,
    });
  }
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
      debug: responseDebug({
        backend: {
          mimetype: null,
          size: null,
          uploadError: err.code || err.message || 'upload_failed',
        },
      }),
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
        debug: responseDebug(debug),
      });
    }

    if (!probe.duration || !probe.codec) {
      return res.status(422).json({
        error: 'audio_unprocessable',
        message: 'فایل صوتی قابل پردازش نیست.',
        debug: responseDebug(debug),
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
          debug: responseDebug(debug),
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
        debug: responseDebug(debug),
      });
    }

    let text = '';
    try {
      if (provider === 'openai') {
        const convertedBuffer = await fsp.readFile(convertedPath);
        text = await transcribeWithOpenAI(convertedBuffer, model, debug);
      } else if (provider === 'vosk') {
        text = await transcribeWithVosk(convertedPath, debug);
      } else if (provider === 'webspeech' || provider === 'deepgram') {
        return res.status(501).json({
          error: 'speech_provider_not_implemented',
          message: 'این provider هنوز پیاده‌سازی نشده است.',
          debug: responseDebug(debug),
        });
      } else {
        return res.status(400).json({
          error: 'speech_provider_invalid',
          message: 'SPEECH_PROVIDER معتبر نیست.',
          debug: responseDebug(debug),
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
          debug: responseDebug(debug),
        });
      }
      if (e.code === 'node_fetch_not_available') {
        return res.status(500).json({
          error: 'node_fetch_not_available',
          message: 'Server runtime must support fetch, FormData and Blob',
          debug: responseDebug(debug),
        });
      }
      if (e.code === 'vosk_venv_missing') {
        debug.vosk = { ...(debug.vosk || {}), ...voskHealthSnapshot() };
        return res.status(503).json({
          error: 'vosk_venv_missing',
          message: 'محیط مجازی Python برای Vosk روی سرور ساخته نشده است.',
          debug: responseDebug(debug),
        });
      }
      if (e.code === 'vosk_model_missing') {
        debug.vosk = { ...(debug.vosk || {}), ...voskHealthSnapshot() };
        return res.status(503).json({
          error: 'vosk_model_missing',
          message: 'مدل تبدیل صدای فارسی روی سرور نصب نشده',
          debug: responseDebug(debug),
        });
      }
      if (e.code === 'vosk_engine_missing') {
        debug.vosk = { ...(debug.vosk || {}), ...voskHealthSnapshot() };
        return res.status(503).json({
          error: 'vosk_engine_missing',
          message: 'موتور Vosk روی سرور نصب نشده است.',
          debug: responseDebug(debug),
        });
      }
      if (e.code === 'vosk_worker_error' || e.code === 'vosk_worker_exited' || e.code === 'vosk_worker_write_failed') {
        return res.status(503).json({
          error: 'vosk_engine_missing',
          message: 'موتور Vosk روی سرور آماده نیست.',
          debug: responseDebug(debug),
        });
      }
      if (e.code === 'audio_unprocessable') {
        return res.status(422).json({
          error: 'audio_unprocessable',
          message: 'فایل صوتی قابل پردازش نیست.',
          debug: responseDebug(debug),
        });
      }
      throw e;
    }

    if (!text) {
      debug.transcription = { textLength: 0 };
      return res.status(422).json({
        error: 'empty_transcription',
        message: 'صدای کافی تشخیص داده نشد',
        debug: responseDebug(debug),
      });
    }

    debug.transcription = { textLength: text.length };
    console.log('[speech] transcription completed', debug.transcription);
    res.json({ text, debug: responseDebug(debug) });
  } catch (e) {
    const msg = e && e.message ? e.message : 'speech transcription error';
    console.error('[speech] transcription route error', e);
    if (msg.includes('audio file required')) {
      return res.status(400).json({ error: 'audio_required', message: 'audio file required' });
    }
    res.status(500).json({ error: 'speech_error', message: msg });
  }
});

if (speechProvider() === 'vosk') {
  setImmediate(() => {
    startVoskWorker()
      .then(info => console.log('[speech] Vosk worker ready', info))
      .catch(err => console.warn('[speech] Vosk worker not ready', err.code || err.message));
  });
}

module.exports = router;
