const { IS_VERCEL } = require('../config/constants');
const { encryptCertificateValue, decryptCertificateValue } = require('../utils/crypto');
const { getEnvCertificate } = require('../utils/cert');
const {
  getSupabaseConfig,
  getSupabaseUserFromToken,
  supabaseRpc
} = require('./supabaseClient');

function normalizeEnvironment(environment) {
  return environment === 'homologacao' ? 'homologacao' : 'producao';
}

function useRemoteCertificateStorage() {
  return IS_VERCEL || process.env.CERT_STORAGE_MODE === 'supabase';
}

async function syncSupabaseCertificate(cert, active = true) {
  if (!cert) return null;
  return supabaseRpc('xml_nfse_upsert_certificate', {
    p_certificate_id: cert.id,
    p_filename: cert.originalName || cert.filename || 'certificado.pfx',
    p_cnpj: cert.cnpj || '',
    p_active: Boolean(active)
  });
}

async function syncSupabaseState({ certificateId, environment, cnpjConsulta, lastNsu, maxNsuSeen, status, nextAllowedAt = null, lastError = null }) {
  return supabaseRpc('xml_nfse_update_sync_state', {
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_cnpj_consulta: cnpjConsulta || '',
    p_last_nsu: Number(lastNsu || 0),
    p_max_nsu_seen: Number(maxNsuSeen || 0),
    p_status: status || 'idle',
    p_next_allowed_at: nextAllowedAt,
    p_last_error: lastError
  });
}

async function startSupabaseRun({ certificateId, environment, cnpjConsulta, startNsu }) {
  return supabaseRpc('xml_nfse_start_run', {
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_cnpj_consulta: cnpjConsulta || '',
    p_start_nsu: Number(startNsu || 0)
  });
}

async function finishSupabaseRun({ runId, status, endNsu = null, maxNsuSeen = null, documentsFound = 0, errorMessage = null }) {
  if (!runId) return null;
  return supabaseRpc('xml_nfse_finish_run', {
    p_run_id: runId,
    p_status: status,
    p_end_nsu: endNsu === null ? null : Number(endNsu),
    p_max_nsu_seen: maxNsuSeen === null ? null : Number(maxNsuSeen),
    p_documents_found: Number(documentsFound || 0),
    p_error_message: errorMessage
  });
}

function normalizeCurrencyForPersistence(value) {
  if (value === null || value === undefined) return 'N/A';

  const normalized = String(value)
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return 'N/A';
  }

  const integerPart = normalized.split('.')[0].replace(/^-/, '');
  if (integerPart.length > 18) {
    return 'N/A';
  }

  return normalized;
}

async function syncSupabaseDocument({ certificateId, environment, doc }) {
  return supabaseRpc('xml_nfse_upsert_document', {
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_nsu: Number(doc.nsu || 0),
    p_tipo: doc.tipo || 'NFSE',
    p_chave: doc.chave || '',
    p_file_name: doc.arquivo || '',
    p_xml_sha256: doc.xmlSha256 || '',
    p_metadata: {
      numeroNfse: doc.numeroNfse,
      prestadorCnpj: doc.prestadorCnpj,
      prestadorNome: doc.prestadorNome,
      tomadorCnpj: doc.tomadorCnpj,
      tomadorNome: doc.tomadorNome,
      valorServico: normalizeCurrencyForPersistence(doc.valorServico),
      dataEmissao: doc.dataEmissao,
      municipioPrestacao: doc.municipioPrestacao,
      codigoTributacao: doc.codigoTributacao,
      competencia: doc.competencia,
      status: doc.status,
      token: doc.token,
      arquivo: doc.arquivo,
      xmlSha256: doc.xmlSha256
    }
  });
}

async function storeSupabaseXmlPayload({ token, certificateId, environment, nsu, fileName, xmlString }) {
  return supabaseRpc('xml_nfse_upsert_xml_payload', {
    p_token: token,
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_nsu: nsu === undefined || nsu === null ? null : Number(nsu),
    p_file_name: fileName,
    p_xml_content: xmlString
  });
}

async function getSupabaseXmlPayload(token) {
  return supabaseRpc('xml_nfse_get_xml_payload', { p_token: token });
}

async function listSupabaseXmlPayloads() {
  return supabaseRpc('xml_nfse_list_xml_payloads', {});
}

async function getStorageSummary({ certificateId = '', environment = '' } = {}) {
  return supabaseRpc('xml_nfse_storage_summary', {
    p_certificate_id: certificateId || null,
    p_environment: environment ? normalizeEnvironment(environment) : null
  });
}

async function getSupabaseSetting(key) {
  return supabaseRpc('xml_nfse_get_setting', { p_key: key });
}

async function setSupabaseSetting(key, value) {
  return supabaseRpc('xml_nfse_set_setting', {
    p_key: key,
    p_value: value
  });
}

async function listRemoteCertificates() {
  const result = await supabaseRpc('xml_nfse_list_certificates', {});
  return Array.isArray(result) ? result : [];
}

async function listUnits() {
  const result = await supabaseRpc('xml_nfse_list_units', {});
  return Array.isArray(result) ? result : [];
}

async function upsertUnit({ id = null, name, cnpj, city = '', state = '' }) {
  return supabaseRpc('xml_nfse_upsert_unit', {
    p_unit_id: id || null,
    p_name: name || '',
    p_cnpj: cnpj || '',
    p_city: city || '',
    p_state: state || ''
  });
}

async function deleteUnit(id) {
  return supabaseRpc('xml_nfse_delete_unit', {
    p_unit_id: id
  });
}

async function listRemoteDocuments({
  certificateId,
  environment,
  startDate,
  endDate,
  cnpj,
  partyCnpj = '',
  partyRole = 'tomador',
  search = '',
  includeCancelled = false,
  limit = null,
  offset = null
}) {
  const result = await supabaseRpc('xml_nfse_list_documents', {
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_start_date: startDate || null,
    p_end_date: endDate || null,
    p_cnpj_consulta: cnpj || '',
    p_party_cnpj: partyCnpj || '',
    p_party_role: partyRole || 'tomador',
    p_search: search || '',
    p_include_cancelled: Boolean(includeCancelled),
    p_limit: limit === null ? null : Number(limit),
    p_offset: offset === null ? null : Number(offset)
  });
  if (Array.isArray(result)) {
    return { documents: result, total: result.length, totalValue: 0 };
  }
  return {
    documents: Array.isArray(result?.documents) ? result.documents : [],
    total: Number(result?.total || 0),
    totalValue: Number(result?.totalValue || result?.total_value || 0)
  };
}

async function setRemoteActiveCertificate(certificateId) {
  return supabaseRpc('xml_nfse_set_active_certificate', { p_certificate_id: certificateId });
}

async function deleteRemoteCertificate(certificateId) {
  return supabaseRpc('xml_nfse_delete_certificate', { p_certificate_id: certificateId });
}

async function renameRemoteCertificate(certificateId, filename) {
  return supabaseRpc('xml_nfse_rename_certificate', {
    p_certificate_id: certificateId,
    p_filename: filename || ''
  });
}

async function upsertRemoteCertificateSecret({ id, filename, cnpj, active, pfxBuffer, passphrase }) {
  const encryptedPfx = encryptCertificateValue(pfxBuffer);
  const encryptedPassphrase = encryptCertificateValue(Buffer.from(passphrase, 'utf8'));
  return supabaseRpc('xml_nfse_upsert_certificate_secret', {
    p_certificate_id: id,
    p_filename: filename,
    p_cnpj: cnpj || '',
    p_active: Boolean(active),
    p_pfx_ciphertext: encryptedPfx.ciphertext,
    p_pfx_iv: encryptedPfx.iv,
    p_pfx_auth_tag: encryptedPfx.authTag,
    p_passphrase_ciphertext: encryptedPassphrase.ciphertext,
    p_passphrase_iv: encryptedPassphrase.iv,
    p_passphrase_auth_tag: encryptedPassphrase.authTag
  });
}

async function resolveRemoteCertificate(certificateId) {
  let id = certificateId;
  if (!id) {
    const certificates = await listRemoteCertificates();
    const active = certificates.find(cert => cert.active) || certificates[0];
    id = active ? active.id : null;
  }
  if (!id) {
    const envCert = getEnvCertificate();
    return envCert || null;
  }
  const row = await supabaseRpc('xml_nfse_get_certificate_secret', { p_certificate_id: id });
  if (!row || !row.pfx_ciphertext || !row.passphrase_ciphertext) {
    const envCert = getEnvCertificate();
    return envCert && envCert.id === id ? envCert : null;
  }
  return {
    id: row.id,
    originalName: row.filename,
    cnpj: row.cnpj || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    passphrase: decryptCertificateValue({
      ciphertext: row.passphrase_ciphertext,
      iv: row.passphrase_iv,
      authTag: row.passphrase_auth_tag
    }).toString('utf8'),
    pfxBuffer: decryptCertificateValue({
      ciphertext: row.pfx_ciphertext,
      iv: row.pfx_iv,
      authTag: row.pfx_auth_tag
    }),
    source: 'supabase'
  };
}

module.exports = {
  getSupabaseConfig,
  useRemoteCertificateStorage,
  getSupabaseUserFromToken,
  supabaseRpc,
  syncSupabaseCertificate,
  syncSupabaseState,
  startSupabaseRun,
  finishSupabaseRun,
  syncSupabaseDocument,
  storeSupabaseXmlPayload,
  getSupabaseXmlPayload,
  listSupabaseXmlPayloads,
  getStorageSummary,
  getSupabaseSetting,
  setSupabaseSetting,
  listRemoteCertificates,
  listUnits,
  upsertUnit,
  deleteUnit,
  listRemoteDocuments,
  setRemoteActiveCertificate,
  deleteRemoteCertificate,
  renameRemoteCertificate,
  upsertRemoteCertificateSecret,
  resolveRemoteCertificate,
  normalizeEnvironment
};
