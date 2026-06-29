const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/teampulse.db');
const db = new Database(DB_PATH);
const JWT_SECRET = process.env.JWT_SECRET || 'teampulse_secret';

db.exec(`
  CREATE TABLE IF NOT EXISTS share_pages (
    token      TEXT PRIMARY KEY,
    html       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
`);

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

const SHARE_MAX_SIZE = 600 * 1024;
const SHARE_TTL_DAYS = 30;

router.post('/', requireAuth, (req, res) => {
  const { html } = req.body;
  if (!html || typeof html !== 'string')
    return res.status(400).json({ error: 'html required' });
  if (html.length > SHARE_MAX_SIZE)
    return res.status(413).json({ error: 'html too large' });

  const token = crypto.randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + SHARE_TTL_DAYS * 86400000);
  const expiresStr = expires.toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`INSERT INTO share_pages (token, html, expires_at) VALUES (?, ?, ?)`)
    .run(token, html, expiresStr);

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const url = `${protocol}://${req.get('host')}/share/${token}`;
  res.json({ token, url });
});

function serveShare(req, res) {
  const { token } = req.params;
  if (!/^[a-f0-9]{32}$/.test(token))
    return res.status(404).send('Not found');

  const row = db.prepare(`
    SELECT html FROM share_pages
    WHERE token = ? AND expires_at > datetime('now')
  `).get(token);

  if (!row) {
    return res.status(404).send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head><meta charset="UTF-8"><title>لینک منقضی شده</title>
<style>body{font-family:Tahoma,sans-serif;text-align:center;padding:60px 20px;background:#f5f5f5}
.box{background:#fff;border-radius:12px;padding:40px;max-width:400px;margin:0 auto}
a{display:inline-block;padding:10px 24px;background:#7c6af7;color:#fff;border-radius:8px;text-decoration:none}</style>
</head><body><div class="box">
<div style="font-size:40px;margin-bottom:16px">⏰</div>
<h2>این لینک منقضی شده</h2>
<p>لینک‌های اشتراک‌گذاری ۳۰ روز معتبر هستند.</p>
<a href="https://teampulse.ir">ورود به TeamPulse</a>
</div></body></html>`);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(row.html);
}

setInterval(() => {
  const r = db.prepare(`DELETE FROM share_pages WHERE expires_at <= datetime('now')`).run();
  if (r.changes > 0) console.log(`[share] cleaned up ${r.changes} expired pages`);
}, 6 * 60 * 60 * 1000);

router.serveShare = serveShare;
module.exports = router;
