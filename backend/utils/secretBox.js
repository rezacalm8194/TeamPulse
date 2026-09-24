const crypto = require('crypto');

const PREFIX = 'tp1.';
const ALGO = 'aes-256-gcm';

function encryptionSecret() {
  const raw = String(process.env.TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || '').trim();
  return raw || '';
}

function canEncryptSecrets() {
  return !!encryptionSecret();
}

function encryptionKey() {
  const secret = encryptionSecret();
  if (!secret) {
    throw new Error('TOKEN_ENCRYPTION_KEY or JWT_SECRET is required to encrypt secrets');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function isEncryptedSecret(value) {
  return String(value || '').startsWith(PREFIX);
}

function encryptSecret(plain) {
  const text = String(plain || '');
  if (!text) return '';
  if (isEncryptedSecret(text)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, enc].map((buf) => buf.toString('base64url')).join('.');
}

function decryptSecret(value) {
  const s = String(value || '');
  if (!s) return '';
  if (!isEncryptedSecret(s)) return s;
  const parts = s.slice(PREFIX.length).split('.');
  if (parts.length !== 3) return '';
  try {
    const [iv, tag, enc] = parts.map((part) => Buffer.from(part, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16 || !enc.length) return '';
    const decipher = crypto.createDecipheriv(ALGO, encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

module.exports = {
  PREFIX,
  canEncryptSecrets,
  isEncryptedSecret,
  encryptSecret,
  decryptSecret,
};
