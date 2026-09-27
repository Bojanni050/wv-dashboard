// Encrypts secrets (AI provider API keys, SMTP password) before they touch
// disk. There is no database here — settings live in data/ai-settings.json —
// so this is what keeps those secrets from being plain text in that file.
//
// Key source: SETTINGS_ENCRYPTION_KEY (base64, 32 bytes) if set — recommended
// for production, and required if data/ is backed up or synced anywhere.
// Otherwise a random key is generated once and kept in data/.encryption-key
// (0600, already covered by .gitignore via data/). Losing that file means
// the encrypted values can no longer be read; the app treats that the same
// as "not set" rather than crashing, so the admin just re-enters them.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';
const KEY_FILE = path.join(__dirname, '..', 'data', '.encryption-key');

let cachedKey = null;

function loadKeyFromEnv() {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('SETTINGS_ENCRYPTION_KEY moet 32 bytes zijn, base64-gecodeerd (bv. `openssl rand -base64 32`)');
  }
  return buf;
}

function loadOrCreateKeyFile() {
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('base64'), { mode: 0o600 });
  return key;
}

function getKey() {
  if (!cachedKey) cachedKey = loadKeyFromEnv() || loadOrCreateKeyFile();
  return cachedKey;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plainText) {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + iv.toString('base64') + ':' + tag.toString('base64') + ':' + ciphertext.toString('base64');
}

// Decrypts a value written by encrypt(). Values that were never encrypted
// (e.g. read once from an older, plain-text settings file) pass through
// unchanged so upgrading doesn't lose existing keys; they get encrypted on
// the next write. A value that can't be decrypted (wrong/rotated key) comes
// back empty instead of throwing, so the app keeps running.
function decrypt(value) {
  if (!value) return '';
  if (!isEncrypted(value)) return value;
  try {
    const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('Kon opgeslagen geheim niet ontsleutelen (sleutel gewijzigd of ontbreekt?):', err.message);
    return '';
  }
}

module.exports = { encrypt, decrypt, isEncrypted };
