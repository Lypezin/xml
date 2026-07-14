const path = require('path');
const https = require('https');

const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;
const MAX_XML_BYTES = 10 * 1024 * 1024;

function sanitizeFileName(value, fallback = 'documento.xml') {
  const base = path.basename(String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim());
  const safe = base
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|[. ]+$/g, '')
    .slice(0, 180);
  return safe || fallback;
}

function resolveContainedPath(baseDir, fileName) {
  const root = path.resolve(baseDir);
  const safeName = sanitizeFileName(fileName);
  const target = path.resolve(root, safeName);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Caminho de arquivo inválido.');
  }
  return target;
}

function rejectUnauthorizedForNfse() {
  return String(process.env.NFSE_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';
}

function createNfseHttpsAgent({ pfx, passphrase }) {
  return new https.Agent({
    pfx,
    passphrase,
    rejectUnauthorized: rejectUnauthorizedForNfse()
  });
}

function safeErrorInfo(error) {
  if (!error) return { message: 'Erro desconhecido' };
  return {
    name: error.name || 'Error',
    message: String(error.message || 'Erro desconhecido').slice(0, 500),
    code: error.code || undefined,
    status: error.response?.status || error.status || undefined
  };
}

module.exports = {
  MAX_CERTIFICATE_BYTES,
  MAX_XML_BYTES,
  sanitizeFileName,
  resolveContainedPath,
  rejectUnauthorizedForNfse,
  createNfseHttpsAgent,
  safeErrorInfo
};
