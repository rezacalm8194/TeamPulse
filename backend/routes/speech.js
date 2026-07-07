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
    const form = new FormData();
    form.append('model', model);
    form.append('language', req.body.language || 'fa');
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), filename);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: 'transcription_failed',
        message: payload.error?.message || 'Speech transcription failed',
      });
    }

    res.json({ text: payload.text || '' });
  } catch (e) {
    const msg = e && e.message ? e.message : 'speech transcription error';
    if (msg.includes('audio file required')) {
      return res.status(400).json({ error: 'audio_required', message: 'audio file required' });
    }
    res.status(500).json({ error: 'speech_error', message: msg });
  }
});

module.exports = router;
