const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { IS_VERCEL, CONFIG_DIR } = require('../config/constants');

const LOCAL_KEY_FILE = path.join(CONFIG_DIR, 'cert-encryption-key.txt');

function resolveKeyMaterial() {
  const explicit = String(process.env.CERT_ENCRYPTION_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (explicit) return { raw: explicit, source: 'env' };

  // No ambiente publicado, reaproveita o segredo interno já obrigatório e
  // deriva uma chave exclusiva para certificados. Nada novo para configurar.
  const appSecret = String(process.env.SUPABASE_APP_SECRET || '').trim();
  if (appSecret) {
    return {
      key: crypto.createHash('sha256').update(`xml-nfse:certificate:v1:${appSecret}`).digest(),
      source: 'derived-app-secret'
    };
  }

  if (!IS_VERCEL) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (!fs.existsSync(LOCAL_KEY_FILE)) {
      fs.writeFileSync(LOCAL_KEY_FILE, crypto.randomBytes(32).toString('hex'), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      });
    }
    return { raw: fs.readFileSync(LOCAL_KEY_FILE, 'utf8').trim(), source: 'local-auto' };
  }

  return { source: null };
}

function decodeKey(raw) {
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');

  let key;
  try { key = Buffer.from(raw, 'base64'); } catch (error) { key = Buffer.alloc(0); }
  if (key.length !== 32) key = Buffer.from(raw, 'utf8');
  return key.length === 32 ? key : null;
}

function getCertificateEncryptionKey() {
  const material = resolveKeyMaterial();
  return material.key || decodeKey(material.raw);
}

function getCertificateEncryptionKeyDiagnostics() {
  try {
    const material = resolveKeyMaterial();
    const key = material.key || decodeKey(material.raw);
    return {
      configured: Boolean(key),
      validLength: Boolean(key),
      source: material.source,
      automatic: material.source === 'derived-app-secret' || material.source === 'local-auto'
    };
  } catch (error) {
    return { configured: false, validLength: false, source: null, error: error.message };
  }
}

function encryptCertificateValue(value) {
  const key = getCertificateEncryptionKey();
  if (!key) throw new Error('A chave automática de certificados não está disponível.');

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
  if (!key) throw new Error('A chave automática de certificados não está disponível.');

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
