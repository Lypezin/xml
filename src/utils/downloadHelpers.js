const { onlyDigits } = require('./cert');
const {
  listRemoteCertificates
} = require('../services/supabase');
const { resolveCertificateForRequest } = require('../services/localCertificates');

const MAX_ZIP_DOCUMENTS_VERCEL = 1000;
const MAX_ZIP_DOCUMENTS_LOCAL = 50000;
const MAX_EXCEL_DOCUMENTS_VERCEL = 20000;
const MAX_EXCEL_DOCUMENTS_LOCAL = 100000;

function clampListLimit(limit) {
  const parsed = Number(limit || 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(parsed, 10);
}

function normalizePartyRole(role) {
  const value = String(role || 'tomador').toLowerCase().trim();
  if (value === 'prestador' || value === 'ambos' || value === 'tomador') return value;
  return 'tomador';
}

function clampListOffset(offset) {
  const parsed = Number(offset || 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/** Interpreta cancelledMode / includeCancelled / onlyCancelled do request. */
function parseCancelledFlags(source = {}) {
  const mode = String(source.cancelledMode || '').toLowerCase();
  let include = String(source.includeCancelled ?? 'false').toLowerCase() === 'true';
  let only = String(source.onlyCancelled ?? 'false').toLowerCase() === 'true';
  if (mode === 'active') {
    include = false;
    only = false;
  } else if (mode === 'all') {
    include = true;
    only = false;
  } else if (mode === 'cancelled') {
    include = true;
    only = true;
  }
  return { includeCancelled: include, onlyCancelled: only };
}

function getUniqueXmlKey(item) {
  const metadata = item.metadata || {};
  const chave = String(item.chave || metadata.chave || '').trim();
  if (chave && chave !== 'N/A' && !chave.startsWith('NSU_')) {
    return `CHAVE:${chave}`;
  }
  return `FILE:${item.token || metadata.token || item.fileName || item.file_name || item.arquivo || item.nsu || 'SEM_CHAVE'}`;
}

function dedupeXmlItems(items) {
  const byKey = new Map();
  const sorted = [...(items || [])].sort((a, b) => {
    const aEvento = String(a.tipo || a.metadata?.tipo || '').toUpperCase() === 'EVENTO';
    const bEvento = String(b.tipo || b.metadata?.tipo || '').toUpperCase() === 'EVENTO';
    return Number(aEvento) - Number(bEvento);
  });
  for (const item of sorted) {
    const key = getUniqueXmlKey(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

function formatCnpj(cnpj) {
  const clean = String(cnpj || '').replace(/\D/g, '');
  if (clean.length !== 14) return cnpj || '';
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatDateBr(dateStr) {
  if (!dateStr || dateStr === 'N/A') return '';
  const dateMatch = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    return `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;
  }
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    const d = String(parsed.getDate()).padStart(2, '0');
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const y = parsed.getFullYear();
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

function getDanfseBaseUrl(environment) {
  return environment === 'homologacao'
    ? 'https://adn.producaorestrita.nfse.gov.br/danfse'
    : 'https://adn.nfse.gov.br/danfse';
}

function getDanfseFileName(chave) {
  const safeKey = onlyDigits(chave) || 'nfse';
  return `DANFSe_${safeKey}.pdf`;
}

function summarizeRemoteError(data) {
  if (!data) return '';
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function getDocumentToken(doc) {
  return doc?.metadata?.token || doc?.token || '';
}

async function resolveCertificateMetadataForList(certificateId) {
  const certificates = await listRemoteCertificates();
  if (Array.isArray(certificates) && certificates.length > 0) {
    const cert = certificateId
      ? certificates.find(item => item.id === certificateId)
      : (certificates.find(item => item.active) || certificates[0]);
    if (cert) return cert;
  }
  if (certificateId) {
    return { id: certificateId, cnpj: '' };
  }
  return resolveCertificateForRequest(certificateId);
}

function buildListFilterParams(source, cert) {
  const receiverCnpj = onlyDigits(source.partyCnpj) || onlyDigits(source.cnpj) || onlyDigits(cert.cnpj);
  const flags = parseCancelledFlags(source);
  return {
    certificateId: cert.id,
    environment: source.environment || 'producao',
    startDate: source.startDate || null,
    endDate: source.endDate || null,
    cnpj: '',
    partyCnpj: receiverCnpj,
    partyRole: normalizePartyRole(source.partyRole),
    search: source.search || '',
    includeCancelled: flags.includeCancelled,
    onlyCancelled: flags.onlyCancelled
  };
}

module.exports = {
  MAX_ZIP_DOCUMENTS_VERCEL,
  MAX_ZIP_DOCUMENTS_LOCAL,
  MAX_EXCEL_DOCUMENTS_VERCEL,
  MAX_EXCEL_DOCUMENTS_LOCAL,
  clampListLimit,
  clampListOffset,
  normalizePartyRole,
  parseCancelledFlags,
  dedupeXmlItems,
  formatCnpj,
  formatDateBr,
  getDanfseBaseUrl,
  getDanfseFileName,
  summarizeRemoteError,
  getDocumentToken,
  resolveCertificateMetadataForList,
  buildListFilterParams
};
