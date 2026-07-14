const { supabaseRpc } = require('./supabaseClient');

function normalizeEnvironment(environment) {
  return environment === 'homologacao' ? 'homologacao' : 'producao';
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

  const numericValue = Number(normalized);
  // Teto 100M: evita gravar lixo (CNPJ/NSU no campo vServ) que distorce rankings
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue >= 100000000) {
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
      dataEmissaoCompleta: doc.dataEmissaoCompleta || doc.dataEmissao,
      descricao: doc.descricao || doc.descricaoServico || 'N/A',
      municipioPrestacao: doc.municipioPrestacao,
      codigoTributacao: doc.codigoTributacao,
      competencia: doc.competencia,
      status: doc.status || 'Autorizada',
      eventoDescricao: doc.eventoDescricao || 'N/A',
      eventoMotivo: doc.eventoMotivo || 'N/A',
      tpEvento: doc.tpEvento || 'N/A',
      isCancellation: Boolean(doc.isCancellation),
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

async function markSupabaseDocumentCancelledByChave({
  certificateId,
  environment,
  chave,
  eventNsu = null,
  eventMeta = {}
}) {
  return supabaseRpc('xml_nfse_mark_cancelled_by_chave', {
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_chave: chave || '',
    p_event_nsu: eventNsu === null || eventNsu === undefined ? null : Number(eventNsu),
    p_event_meta: eventMeta || {}
  });
}

async function getSupabaseXmlPayload(token) {
  return supabaseRpc('xml_nfse_get_xml_payload', { p_token: token });
}

async function getSupabaseXmlPayloads(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const result = await supabaseRpc('xml_nfse_get_xml_payloads_by_tokens', { p_tokens: tokens });
  return Array.isArray(result) ? result : [];
}

async function getStorageSummary({ certificateId = '', environment = '' } = {}) {
  return supabaseRpc('xml_nfse_storage_summary', {
    p_certificate_id: certificateId || null,
    p_environment: environment ? normalizeEnvironment(environment) : null
  });
}

/** Tamanho de página para exportações. A RPC pode capar (ex.: 100 ou 500); o loop usa o retornado. */
const EXPORT_PAGE_SIZE = 500;

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
  onlyCancelled = false,
  limit = null,
  offset = null,
  skipTotals = false
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
    p_include_cancelled: Boolean(includeCancelled) || Boolean(onlyCancelled),
    p_only_cancelled: Boolean(onlyCancelled),
    p_limit: limit === null ? null : Number(limit),
    p_offset: offset === null ? null : Number(offset),
    p_skip_totals: Boolean(skipTotals)
  });
  if (Array.isArray(result)) {
    return { documents: result, total: result.length, totalValue: 0, totalsPending: false };
  }
  const totalsPending = Boolean(result?.totalsPending) || result?.total == null;
  return {
    documents: Array.isArray(result?.documents) ? result.documents : [],
    total: totalsPending ? null : Number(result?.total || 0),
    totalValue: totalsPending ? null : Number(result?.totalValue || result?.total_value || 0),
    totalsPending
  };
}

/**
 * Busca todos os documentos do filtro em páginas (contorna o teto da RPC).
 * A listagem da UI continua paginada; só export Excel/ZIP deve usar isto.
 */
async function listAllRemoteDocuments(filter = {}, { maxDocuments = null, pageSize = EXPORT_PAGE_SIZE } = {}) {
  const safePageSize = Math.max(1, Math.min(Number(pageSize) || EXPORT_PAGE_SIZE, 1000));
  const hardMax = maxDocuments == null || !Number.isFinite(Number(maxDocuments))
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Number(maxDocuments));

  if (hardMax === 0) {
    return { documents: [], total: 0, totalValue: 0 };
  }

  const first = await listRemoteDocuments({
    ...filter,
    limit: Math.min(safePageSize, Number.isFinite(hardMax) ? hardMax : safePageSize),
    offset: 0,
    skipTotals: false
  });

  let total = first.totalsPending ? null : Number(first.total || 0);
  let totalValue = first.totalsPending ? null : Number(first.totalValue || 0);
  const documents = [...(first.documents || [])];

  if (total == null) {
    try {
      const totals = await getRemoteDocumentTotals(filter);
      total = Number(totals.total || 0);
      totalValue = Number(totals.totalValue || 0);
    } catch (err) {
      total = documents.length;
      totalValue = 0;
    }
  }

  if (total === 0 && documents.length === 0) {
    return { documents: [], total: 0, totalValue: 0 };
  }

  let offset = documents.length;
  // Se o total da RPC for confiável, usa-o; senão avança até a API esvaziar.
  const target = Number.isFinite(hardMax)
    ? Math.min(hardMax, total > 0 ? total : hardMax)
    : (total > 0 ? total : Number.POSITIVE_INFINITY);

  let pages = 0;
  const maxPages = 20000; // guarda de segurança

  while (documents.length < target && pages < maxPages) {
    pages += 1;
    const remaining = Number.isFinite(target) ? target - documents.length : safePageSize;
    if (remaining <= 0) break;

    const page = await listRemoteDocuments({
      ...filter,
      limit: Math.min(safePageSize, remaining),
      offset,
      skipTotals: true
    });
    const batch = page.documents || [];
    if (batch.length === 0) break;

    documents.push(...batch);
    offset += batch.length;
  }

  const sliced = Number.isFinite(hardMax) ? documents.slice(0, hardMax) : documents;
  return {
    documents: sliced,
    total: total || sliced.length,
    totalValue: totalValue || 0
  };
}

async function getRemoteDocumentTotals({
  certificateId,
  environment,
  startDate,
  endDate,
  cnpj,
  partyCnpj = '',
  partyRole = 'tomador',
  search = '',
  includeCancelled = false,
  onlyCancelled = false
}) {
  const result = await supabaseRpc('xml_nfse_get_document_totals', {
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_start_date: startDate || null,
    p_end_date: endDate || null,
    p_cnpj_consulta: cnpj || '',
    p_party_cnpj: partyCnpj || '',
    p_party_role: partyRole || 'tomador',
    p_search: search || '',
    p_include_cancelled: Boolean(includeCancelled) || Boolean(onlyCancelled),
    p_only_cancelled: Boolean(onlyCancelled)
  });
  return {
    total: Number(result?.total || 0),
    totalValue: Number(result?.totalValue || result?.total_value || 0),
    source: result?.source || 'scan'
  };
}

module.exports = {
  normalizeEnvironment,
  syncSupabaseDocument,
  storeSupabaseXmlPayload,
  markSupabaseDocumentCancelledByChave,
  getSupabaseXmlPayload,
  getSupabaseXmlPayloads,
  getStorageSummary,
  listRemoteDocuments,
  listAllRemoteDocuments,
  getRemoteDocumentTotals,
  EXPORT_PAGE_SIZE
};
