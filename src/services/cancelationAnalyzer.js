const axios = require('axios');
const zlib = require('zlib');
const {
  getNationalApiBaseUrl,
  buildEventosUrl,
  getCancelCheckMode,
  isNationalApiFiscalStatus,
  extractDfeDocuments
} = require('./nfse');
const { isCancellationEvent, parseXmlMetadata } = require('../utils/xmlParser');
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

function decodeArquivoXml(b64) {
  if (!b64) return '';
  try {
    const raw = Buffer.from(b64, 'base64');
    try {
      return zlib.gunzipSync(raw).toString('utf8');
    } catch {
      return raw.toString('utf8');
    }
  } catch {
    return '';
  }
}

function analyzeEventItem(item) {
  if (!item || typeof item !== 'object') {
    return { isCancel: false, nsu: null, meta: {} };
  }

  const nsu = item.NSU !== undefined ? item.NSU : (item.nsu !== undefined ? item.nsu : null);
  const tipo = item.TipoDocumento || item.tipoDocumento || '';
  const chave = item.ChaveAcesso || item.chaveAcesso || '';
  const xml = decodeArquivoXml(item.ArquivoXml || item.arquivoXml || item.conteudo || item.docZip);
  const parsed = xml ? parseXmlMetadata(xml, nsu) : {};

  const meta = {
    status: item.Status || item.status || parsed.status || tipo,
    tipo: tipo || parsed.tipo,
    eventoDescricao: item.xDesc || item.Descricao || item.descricao || item.xEvento || parsed.eventoDescricao,
    eventoMotivo: item.xMotivo || item.Motivo || item.motivo || parsed.eventoMotivo,
    tpEvento: item.tpEvento || item.TpEvento || item.Codigo || item.codigo || parsed.tpEvento,
    chave: (chave && chave !== 'N/A' ? chave : null) || parsed.chave,
    isCancellation: Boolean(parsed.isCancellation)
  };

  const isCancel =
    meta.isCancellation ||
    isCancellationEvent(meta) ||
    /e101101|e105102|Cancelamento de NFS-e/i.test(xml);

  return {
    isCancel,
    nsu: nsu === null || nsu === undefined ? null : Number(nsu),
    meta: {
      ...meta,
      isCancellation: isCancel,
      status: isCancel ? 'Cancelada' : meta.status,
      tpEvento: meta.tpEvento || (isCancel ? 'e101101' : meta.tpEvento)
    },
    xml
  };
}

function eventItemLooksCancelled(item) {
  return analyzeEventItem(item).isCancel;
}

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

    // Fallback: corpo bruto (pouco confiavel com base64, mas barato)
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
 * - Camada A: EVENTOs de cancel no lote (novos ou reprocessados) marcam a NFSe
 * - Camada B: NFSe do lote ainda nao canceladas -> GET /Eventos (decodifica XML)
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

  // Camada A: qualquer EVENTO de cancelamento no lote (inserted ou update)
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

  // Camada B: NFSe do lote ainda nao canceladas (novas ou reprocessadas)
  if (mode === 'lote+eventos' && httpsAgent) {
    const nfseToCheck = items.filter(item => {
      const doc = item.doc;
      return doc &&
        !isEventoDoc(doc) &&
        isValidChave(doc.chave) &&
        !marked.has(doc.chave) &&
        !docIsCancellation(doc);
    });

    // Prioriza notas novas; depois reprocessadas. Cap para nao estourar a ADN.
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
