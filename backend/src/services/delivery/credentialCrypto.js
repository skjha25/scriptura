'use strict';

/**
 * AES-256-GCM encrypt/decrypt for a `publishing_integrations` credential.
 *
 * Node's built-in `crypto` — no new dependency, matching how this codebase
 * already uses `crypto` elsewhere (random IDs, storage keys). The key itself
 * follows this codebase's existing convention for real secret material:
 * lives only in `CONFIG_ENCRYPTION_KEY` (env), never in the database — the
 * database only ever holds ciphertext.
 *
 * Deliberately checked LAZILY (inside encrypt/decrypt, not at config load
 * time): most deployments never configure a client integration at all, and
 * this must not become a new mandatory boot-time env var for every
 * environment, the same reasoning `config.gsc`/`config.serp` already apply
 * to their own optional credentials.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // NIST-recommended for GCM.
const FORMAT_VERSION = 'v1';

function getKey() {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'CONFIG_ENCRYPTION_KEY is not set — required to save or use a publishing integration credential. ' +
        'Set a base64-encoded 32-byte key in backend/.env (e.g. `openssl rand -base64 32`).'
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `CONFIG_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256-GCM (got ${key.length}).`
    );
  }
  return key;
}

/**
 * @param {string} plaintext
 * @returns {string} `v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>`
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * @param {string} stored Output of `encrypt`.
 * @returns {string} plaintext
 */
function decrypt(stored) {
  const key = getKey();
  const parts = String(stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error('Stored credential is not in the expected format — cannot decrypt.');
  }
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
