const router = require('express').Router();
const multer = require('multer');
const auth = require('../middleware/auth');

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

router.post('/transcribe', auth, upload.single('audio'), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: 'speech_service_not_configured',
        message: 'OPENAI_API_KEY is not configured on the server',
      });
    }
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
    const filename = req.file.originalname || 'voice.webm';
    console.log('[speech] received audio', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path || null,
    });
    const form = new FormData();
    form.append('model', model);
    form.append('language', 'fa');
    form.append('prompt', 'این فایل شامل گفتار فارسی است. متن را دقیق و روان به فارسی پیاده‌سازی کن.');
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), filename);

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
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          path: req.file.path || null,
        },
      });
      const openAiMessage = payload.error?.message || 'Speech transcription failed';
      const isFormatError = /format|codec|mime|unsupported|invalid file/i.test(openAiMessage);
      return res.status(response.status).json({
        error: isFormatError ? 'unsupported_audio_format' : 'transcription_failed',
        message: process.env.NODE_ENV === 'production' ? 'Speech transcription failed' : openAiMessage,
        details: process.env.NODE_ENV === 'production' ? undefined : payload.error,
      });
    }

    console.log('[speech] transcription completed', { textLength: (payload.text || '').length });
    res.json({ text: payload.text || '' });
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
