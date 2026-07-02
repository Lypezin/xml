const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { IS_VERCEL, CONFIG_DIR } = require('../config/constants');

function getCertificateEncryptionKey() {
  let raw = process.env.CERT_ENCRYPTION_KEY;

  if (!raw && !IS_VERCEL) {
    const keyPath = path.join(CONFIG_DIR, 'cert-encryption-key.txt');
    if (fs.existsSync(keyPath)) {
      try {
        raw = fs.readFileSync(keyPath, 'utf8');
      } catch (e) {
        console.error('Erro ao ler cert-encryption-key.txt:', e.message);
      }
    }
  }

  if (!raw) return null;

  raw = raw.trim().replace(/^["']|["']$/g, '');

  let key;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    try {
      key = Buffer.from(raw, 'base64');
    } catch (e) {
      key = Buffer.alloc(0);
    }

    if (key.length !== 32) {
      key = Buffer.from(raw, 'utf8');
    }
  }

  return key.length === 32 ? key : null;
}

function getCertificateEncryptionKeyDiagnostics() {
  let raw = process.env.CERT_ENCRYPTION_KEY;
  let source = raw ? 'env' : null;

  if (!raw && !IS_VERCEL) {
    const keyPath = path.join(CONFIG_DIR, 'cert-encryption-key.txt');
    if (fs.existsSync(keyPath)) {
      try {
        raw = fs.readFileSync(keyPath, 'utf8');
        source = 'config/cert-encryption-key.txt';
      } catch (e) {
        return {
          configured: false,
          validLength: false,
          source: 'config/cert-encryption-key.txt',
          error: e.message
        };
      }
    }
  }

  if (!raw) {
    return {
      configured: false,
      validLength: false,
      source: null
    };
  }

  raw = raw.trim().replace(/^["']|["']$/g, '');
  const key = getCertificateEncryptionKey();

  return {
    configured: true,
    validLength: Boolean(key),
    source,
    format: /^[0-9a-f]{64}$/i.test(raw) ? 'hex' : 'base64-or-utf8',
    rawLength: raw.length
  };
}

function encryptCertificateValue(value) {
  const key = getCertificateEncryptionKey();
  if (!key) {
    throw new Error('CERT_ENCRYPTION_KEY deve ter 32 bytes. Use 64 caracteres hexadecimais ou Base64 de 32 bytes.');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64')
  };
}

function decryptCertificateValue(payload) {
  const key = getCertificateEncryptionKey();
  if (!key) {
    throw new Error('CERT_ENCRYPTION_KEY deve ter 32 bytes para descriptografar certificados.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]);
}

module.exports = {
  getCertificateEncryptionKey,
  getCertificateEncryptionKeyDiagnostics,
  encryptCertificateValue,
  decryptCertificateValue
};
