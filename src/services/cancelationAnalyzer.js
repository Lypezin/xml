const axios = require('axios');
const {
  getNationalApiBaseUrl,
  buildEventosUrl,
  getCancelCheckMode,
  isNationalApiFiscalStatus
} = require('./nfse');
const { isCancellationEvent } = require('../utils/xmlParser');
const { markSupabaseDocumentCancelledByChave } = require('./supabase');
const {
  isValidChave,
  isEventoDoc,
  docIsCancellation,
  extractEventItems,
  decodeArquivoXml,
  analyzeEventItem
} = require('./cancelationEventUtils');

/**
 * Consulta GET /NFSe/{chave}/Eventos e retorna se ha cancelamento + meta do evento.
 */
async function fetchChaveCancellationInfo({ httpsAgent, environment, chave }) {
  const baseUrl = getNationalApiBaseUrl(environment);
  const url = buildEventosUrl(baseUrl, chave);
  if (!url) return { hasCancel: false };

  try {
    const response = await axios.get(url, {
      httpsAgent,
      timeout: 15000,
      validateStatus: isNationalApiFiscalStatus,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'NFS-e Batch Downloader Local'
      }
    });

    if (!response.data) return { hasCancel: false };
    const status = String(
      response.data.StatusProcessamento ||
      response.data.statusProcessamento ||
      ''
    ).toUpperCase();
    if (status === 'REJEICAO' || status === 'NENHUM_DOCUMENTO_LOCALIZADO') {
      return { hasCancel: false };
    }

    const events = extractEventItems(response.data);
    let best = null;
    for (const item of events) {
      const analyzed = analyzeEventItem(item);
      if (!analyzed.isCancel) continue;
      if (!best || (analyzed.nsu || 0) > (best.nsu || 0)) {
        best = analyzed;
      }
    }

    if (best) {
      return {
        hasCancel: true,
        eventNsu: best.nsu,
        eventMeta: {
          eventoDescricao: best.meta.eventoDescricao,
          eventoMotivo: best.meta.eventoMotivo,
          tpEvento: best.meta.tpEvento,
          source: 'eventos_api'
        }
      };
    }

    if (isCancellationEvent({ status: JSON.stringify(response.data).slice(0, 4000) })) {
      return { hasCancel: true, eventMeta: { source: 'eventos_api_raw' } };
    }

    return { hasCancel: false };
  } catch (err) {
    console.warn(`[Cancel] Falha ao consultar Eventos da chave ${chave}: ${err.message}`);
    return { hasCancel: false };
  }
}

async function fetchChaveHasCancellationEvent(args) {
  const info = await fetchChaveCancellationInfo(args);
  return Boolean(info.hasCancel);
}

/**
 * Analisa cancelamento no lote:
 * - Camada A: EVENTOs de cancel no lote marcam a NFSe
 * - Camada B: NFSe do lote ainda nao canceladas -> GET /Eventos
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

  for (const item of items) {
    const doc = item.doc;
    if (!doc || !isEventoDoc(doc) || !docIsCancellation(doc)) continue;
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

  if (mode === 'lote+eventos' && httpsAgent) {
    const nfseToCheck = items.filter(item => {
      const doc = item.doc;
      return doc &&
        !isEventoDoc(doc) &&
        isValidChave(doc.chave) &&
        !marked.has(doc.chave) &&
        !docIsCancellation(doc);
    });

    const sorted = [
      ...nfseToCheck.filter(i => i.inserted),
      ...nfseToCheck.filter(i => !i.inserted)
    ];
    const toCheck = sorted.slice(0, 15);

    for (const item of toCheck) {
      const chave = item.doc.chave;
      const info = await fetchChaveCancellationInfo({
        httpsAgent,
        environment,
        chave
      });
      if (!info.hasCancel) continue;

      const result = await markSupabaseDocumentCancelledByChave({
        certificateId,
        environment,
        chave,
        eventNsu: info.eventNsu,
        eventMeta: info.eventMeta || { source: 'eventos_api' }
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
  isValidChave,
  fetchChaveHasCancellationEvent,
  fetchChaveCancellationInfo,
  analyzeEventItem,
  decodeArquivoXml
};
