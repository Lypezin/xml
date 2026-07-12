const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { IS_VERCEL, CERTS_INDEX_FILE, CERTS_DIR, CONFIG_DIR } = require('../config/constants');
const { getEnvCertificate } = require('../utils/cert');
const { getSettings, saveSettings } = require('../utils/settings');
const { useRemoteCertificateStorage, resolveRemoteCertificate } = require('./supabase');

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
  fs.writeFileSync(CERTS_INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
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

  const id = crypto.randomUUID();
  const storedName = `${id}.pfx`;
  fs.copyFileSync(CERT_FILE, path.join(CERTS_DIR, storedName));

  const cert = {
    id,
    originalName: settings.filename || 'certificado.pfx',
    storedName,
    passphrase: settings.passphrase,
    cnpj: settings.cnpj || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const nextIndex = {
    activeCertificateId: id,
    certificates: [cert]
  };
  saveCertificatesIndex(nextIndex);
  saveSettings({
    ...settings,
    activeCertificateId: id
  });
  return nextIndex;
}

function getCertificatesIndex() {
  return migrateLegacyCertificateIfNeeded();
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

  const filePath = path.join(CERTS_DIR, cert.storedName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return {
    ...cert,
    filePath
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
  setActiveCertificate
};
