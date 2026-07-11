const axios = require('axios');
const {
  getNationalApiBaseUrl,
  buildEventosUrl,
  getCancelCheckMode,
  isNationalApiFiscalStatus,
  extractDfeDocuments
} = require('./nfse');
const { isCancellationEvent } = require('../utils/xmlParser');
const { markSupabaseDocumentCancelledByChave } = require('./supabase');

function isValidChave(chave) {
  const value = String(chave || '').trim();
  return Boolean(value && value !== 'N/A' && !value.startsWith('NSU_'));
}

function isEventoDoc(doc) {
  return String(doc?.tipo || '').toUpperCase() === 'EVENTO';
}

function docIsCancellation(doc) {
  if (doc?.isCancellation) return true;
  return isCancellationEvent({
    status: doc?.status,
    tipo: doc?.tipo,
    eventoDescricao: doc?.eventoDescricao,
    eventoMotivo: doc?.eventoMotivo,
    descricao: doc?.descricao,
    tpEvento: doc?.tpEvento
  });
}

function extractEventItems(responseData) {
  if (!responseData) return [];
  if (Array.isArray(responseData.LoteDFe)) return responseData.LoteDFe;
  if (Array.isArray(responseData.loteDFe)) return responseData.loteDFe;
  if (Array.isArray(responseData.Eventos)) return responseData.Eventos;
  if (Array.isArray(responseData.eventos)) return responseData.eventos;
  const fromGeneric = extractDfeDocuments(responseData);
  if (fromGeneric.length) return fromGeneric;
  if (Array.isArray(responseData)) return responseData;
  return [];
}

function eventItemLooksCancelled(item) {
  if (!item || typeof item !== 'object') return false;
  return isCancellationEvent({
    status: item.Status || item.status || item.TipoDocumento || item.tipoDocumento,
    tipo: item.TipoDocumento || item.tipoDocumento,
    eventoDescricao: item.xDesc || item.Descricao || item.descricao || item.xEvento,
    eventoMotivo: item.xMotivo || item.Motivo || item.motivo,
    tpEvento: item.tpEvento || item.TpEvento || item.Codigo || item.codigo
  });
}

async function fetchChaveHasCancellationEvent({ httpsAgent, environment, chave }) {
  const baseUrl = getNationalApiBaseUrl(environment);
  const url = buildEventosUrl(baseUrl, chave);
  if (!url) return false;

  try {
    const response = await axios.get(url, {
      httpsAgent,
      timeout: 12000,
      validateStatus: isNationalApiFiscalStatus,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'NFS-e Batch Downloader Local'
      }
    });

    if (!response.data) return false;
    const status = String(
      response.data.StatusProcessamento ||
      response.data.statusProcessamento ||
      ''
    ).toUpperCase();
    if (status === 'REJEICAO' || status === 'NENHUM_DOCUMENTO_LOCALIZADO') {
      return false;
    }

    const events = extractEventItems(response.data);
    if (events.some(eventItemLooksCancelled)) return true;

    // Alguns retornos embutem texto de cancel no corpo
    return isCancellationEvent({
      status: JSON.stringify(response.data).slice(0, 2000)
    });
  } catch (err) {
    console.warn(`[Cancel] Falha ao consultar Eventos da chave ${chave}: ${err.message}`);
    return false;
  }
}

/**
 * Analisa cancelamento apenas para documentos novos do lote (e EVENTOs novos).
 * Nao reprocessa o historico completo.
 */
async function analyzeBatchCancellations({
  certificateId,
  environment,
  upsertedDocs,
  httpsAgent
}) {
  const mode = getCancelCheckMode();
  if (mode === 'off') {
    return { canceladasNovas: 0, eventosCancelamento: 0, markedChaves: [] };
  }

  const marked = new Set();
  let eventosCancelamento = 0;
  let canceladasNovas = 0;

  const items = Array.isArray(upsertedDocs) ? upsertedDocs : [];

  // Camada A: EVENTOs novos de cancelamento no lote → marca NFSE pai por chave
  for (const item of items) {
    const doc = item.doc;
    if (!item.inserted || !doc || !isEventoDoc(doc) || !docIsCancellation(doc)) continue;
    if (!isValidChave(doc.chave)) continue;

    eventosCancelamento += 1;
    if (marked.has(doc.chave)) continue;

    const result = await markSupabaseDocumentCancelledByChave({
      certificateId,
      environment,
      chave: doc.chave,
      eventNsu: doc.nsu,
      eventMeta: {
        eventoDescricao: doc.eventoDescricao,
        eventoMotivo: doc.eventoMotivo,
        tpEvento: doc.tpEvento,
        eventNsu: doc.nsu
      }
    });

    if (result?.updated) {
      marked.add(doc.chave);
      canceladasNovas += Number(result.updated_count || 1);
    }
  }

  // Camada B: NFSE novas → consulta GET /NFSe/{chave}/Eventos (somente inserted)
  if (mode === 'lote+eventos' && httpsAgent) {
    const newNfse = items.filter(item => {
      const doc = item.doc;
      return item.inserted &&
        doc &&
        !isEventoDoc(doc) &&
        isValidChave(doc.chave) &&
        !marked.has(doc.chave) &&
        !docIsCancellation(doc);
    });

    // Limita pressão na API: no max 10 chaves novas por lote, em serie
    const toCheck = newNfse.slice(0, 10);
    for (const item of toCheck) {
      const chave = item.doc.chave;
      const hasCancel = await fetchChaveHasCancellationEvent({
        httpsAgent,
        environment,
        chave
      });
      if (!hasCancel) continue;

      const result = await markSupabaseDocumentCancelledByChave({
        certificateId,
        environment,
        chave,
        eventMeta: { source: 'eventos_api' }
      });
      if (result?.updated) {
        marked.add(chave);
        canceladasNovas += Number(result.updated_count || 1);
        item.doc.status = 'Cancelada';
        item.doc.isCancellation = true;
      }
    }
  }

  if (marked.size > 0) {
    console.log(`[Cancel] Lote: ${eventosCancelamento} evento(s) cancel, ${canceladasNovas} NFSe marcada(s).`);
  }

  return {
    canceladasNovas,
    eventosCancelamento,
    markedChaves: Array.from(marked)
  };
}

module.exports = {
  analyzeBatchCancellations,
  docIsCancellation,
  isValidChave
};
