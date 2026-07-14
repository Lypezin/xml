const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { IS_VERCEL, CERTS_INDEX_FILE, CERTS_DIR, CONFIG_DIR } = require('../config/constants');
const { getEnvCertificate } = require('../utils/cert');
const { getSettings, saveSettings } = require('../utils/settings');
const { useRemoteCertificateStorage, resolveRemoteCertificate } = require('./supabase');
const { encryptCertificateValue, decryptCertificateValue, getCertificateEncryptionKey } = require('../utils/crypto');
const { resolveContainedPath } = require('../utils/security');

const CERT_FILE = path.join(CONFIG_DIR, 'certificate.pfx');

function readCertificatesIndex() {
  const envCert = getEnvCertificate();
  if (envCert && IS_VERCEL) {
    return {
      activeCertificateId: envCert.id,
      certificates: [envCert]
    };
  }

  if (!fs.existsSync(CERTS_INDEX_FILE)) {
    return { activeCertificateId: null, certificates: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CERTS_INDEX_FILE, 'utf8'));
    return {
      activeCertificateId: parsed.activeCertificateId || null,
      certificates: Array.isArray(parsed.certificates) ? parsed.certificates : []
    };
  } catch (e) {
    console.error('Erro ao ler certificates.json:', e);
    return { activeCertificateId: null, certificates: [] };
  }
}

function saveCertificatesIndex(index) {
  if (IS_VERCEL) return;
  fs.writeFileSync(CERTS_INDEX_FILE, JSON.stringify(index, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function writeEncryptedLocalCertificate(id, pfxBuffer, passphrase) {
  if (!getCertificateEncryptionKey()) {
    const error = new Error('A chave automática de certificados não está disponível.');
    error.code = 'CERTIFICATE_KEY_UNAVAILABLE';
    throw error;
  }
  const storedName = `${id}.cert.enc`;
  const payload = {
    version: 1,
    pfx: encryptCertificateValue(pfxBuffer),
    passphrase: encryptCertificateValue(Buffer.from(passphrase, 'utf8'))
  };
  fs.writeFileSync(
    resolveContainedPath(CERTS_DIR, storedName),
    JSON.stringify(payload),
    { encoding: 'utf8', mode: 0o600 }
  );
  return storedName;
}

function readEncryptedLocalCertificate(storedName) {
  const payload = JSON.parse(fs.readFileSync(resolveContainedPath(CERTS_DIR, storedName), 'utf8'));
  if (payload?.version !== 1 || !payload.pfx || !payload.passphrase) {
    throw new Error('Formato do certificado local criptografado é inválido.');
  }
  return {
    pfxBuffer: decryptCertificateValue(payload.pfx),
    passphrase: decryptCertificateValue(payload.passphrase).toString('utf8')
  };
}

function migratePlaintextCertificates(index) {
  if (!getCertificateEncryptionKey()) return index;
  let changed = false;
  for (const cert of index.certificates) {
    if (!cert.passphrase || !cert.storedName || cert.encrypted) continue;
    const oldPath = resolveContainedPath(CERTS_DIR, cert.storedName);
    if (!fs.existsSync(oldPath)) continue;
    const storedName = writeEncryptedLocalCertificate(
      cert.id,
      fs.readFileSync(oldPath),
      cert.passphrase
    );
    cert.storedName = storedName;
    cert.encrypted = true;
    delete cert.passphrase;
    fs.unlinkSync(oldPath);
    changed = true;
  }
  if (changed) saveCertificatesIndex(index);
  return index;
}

function sanitizeCertificate(cert) {
  return {
    id: cert.id,
    filename: cert.originalName || cert.filename || 'certificado.pfx',
    cnpj: cert.cnpj || '',
    active: Boolean(cert.active),
    validUntil: cert.validUntil || cert.valid_until || null,
    createdAt: cert.createdAt || cert.created_at || null,
    updatedAt: cert.updatedAt || cert.updated_at || null
  };
}

function migrateLegacyCertificateIfNeeded() {
  const index = readCertificatesIndex();
  if (index.certificates.length > 0 || !fs.existsSync(CERT_FILE)) {
    return index;
  }

  const settings = getSettings();
  if (!settings || !settings.passphrase) {
    return index;
  }

  if (!getCertificateEncryptionKey()) {
    throw new Error('A chave automática de certificados não está disponível para a migração local.');
  }
  const id = nodeCrypto.randomUUID();
  const storedName = writeEncryptedLocalCertificate(id, fs.readFileSync(CERT_FILE), settings.passphrase);

  const cert = {
    id,
    originalName: settings.filename || 'certificado.pfx',
    storedName,
    encrypted: true,
    cnpj: settings.cnpj || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const nextIndex = {
    activeCertificateId: id,
    certificates: [cert]
  };
  saveCertificatesIndex(nextIndex);
  const nextSettings = {
    ...settings,
    activeCertificateId: id
  };
  delete nextSettings.passphrase;
  saveSettings(nextSettings);
  fs.unlinkSync(CERT_FILE);
  return nextIndex;
}

function getCertificatesIndex() {
  return migratePlaintextCertificates(migrateLegacyCertificateIfNeeded());
}

function resolveCertificate(certificateId) {
  const envCert = getEnvCertificate();
  if (envCert && (!certificateId || certificateId === envCert.id)) {
    return envCert;
  }

  const index = getCertificatesIndex();
  const id = certificateId || index.activeCertificateId;
  const cert = index.certificates.find(item => item.id === id);

  if (!cert) {
    return null;
  }

  const filePath = resolveContainedPath(CERTS_DIR, cert.storedName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  if (cert.encrypted || cert.storedName.endsWith('.enc')) {
    const secret = readEncryptedLocalCertificate(cert.storedName);
    return { ...cert, ...secret, source: 'local-encrypted' };
  }

  return {
    ...cert,
    filePath,
    source: 'local-legacy-plaintext'
  };
}

async function resolveCertificateForRequest(certificateId) {
  if (useRemoteCertificateStorage()) {
    return resolveRemoteCertificate(certificateId);
  }
  return resolveCertificate(certificateId);
}

function setActiveCertificate(certificateId) {
  const envCert = getEnvCertificate();
  if (envCert && certificateId === envCert.id) {
    return envCert;
  }

  if (IS_VERCEL) return null;

  const index = getCertificatesIndex();
  const exists = index.certificates.some(cert => cert.id === certificateId);
  if (!exists) return null;

  index.activeCertificateId = certificateId;
  saveCertificatesIndex(index);

  const settings = getSettings() || {};
  saveSettings({
    ...settings,
    activeCertificateId: certificateId
  });

  return resolveCertificate(certificateId);
}

module.exports = {
  readCertificatesIndex,
  saveCertificatesIndex,
  sanitizeCertificate,
  getCertificatesIndex,
  resolveCertificate,
  resolveCertificateForRequest,
  setActiveCertificate,
  writeEncryptedLocalCertificate
};
