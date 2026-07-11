const zlib = require('zlib');
const { extractDfeDocuments } = require('./nfse');
const { isCancellationEvent, parseXmlMetadata } = require('../utils/xmlParser');

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

module.exports = {
  isValidChave,
  isEventoDoc,
  docIsCancellation,
  extractEventItems,
  decodeArquivoXml,
  analyzeEventItem,
  eventItemLooksCancelled
};
