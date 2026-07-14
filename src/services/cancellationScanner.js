const https = require('https');
const {
  fetchChaveCancellationInfo,
  isValidChave
} = require('./cancelationAnalyzer');
const {
  markSupabaseDocumentCancelledByChave,
  listRemoteDocuments,
  normalizeEnvironment
} = require('./supabase');
const { getCertificateBuffer } = require('../utils/cert');
const { createNfseHttpsAgent } = require('../utils/security');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Lista chaves ativas no periodo e consulta Eventos na ADN.
 * Marca NFSe canceladas encontradas.
 */
async function scanCancellationsForPeriod({
  certificate,
  environment = 'producao',
  startDate,
  endDate,
  maxKeys = 80,
  delayMs = 350
}) {
  const env = normalizeEnvironment(environment);
  const pfx = getCertificateBuffer(certificate);
  if (!certificate || !pfx || !certificate.passphrase) {
    throw new Error('Certificado nao disponivel para consultar Eventos na ADN.');
  }

  if (!startDate || !endDate) {
    throw new Error('Informe startDate e endDate (YYYY-MM-DD).');
  }

  const limit = Math.min(Math.max(Number(maxKeys) || 80, 1), 200);

  const pageSize = 50;
  const candidates = [];
  let offset = 0;
  while (candidates.length < limit) {
    const page = await listRemoteDocuments({
      certificateId: certificate.id,
      environment: env,
      startDate,
      endDate,
      includeCancelled: false,
      onlyCancelled: false,
      limit: pageSize,
      offset
    });
    const docs = page.documents || [];
    if (!docs.length) break;
    for (const doc of docs) {
      const chave = doc.chave || doc.metadata?.chave;
      if (!isValidChave(chave)) continue;
      candidates.push({
        chave: String(chave).trim(),
        nsu: doc.nsu,
        numeroNfse: doc.numero_nfse || doc.numeroNfse || doc.metadata?.numeroNfse
      });
      if (candidates.length >= limit) break;
    }
    offset += docs.length;
    if (docs.length < pageSize) break;
    // protecao
    if (offset > 5000) break;
  }

  const httpsAgent = createNfseHttpsAgent({
    pfx,
    passphrase: certificate.passphrase
  });

  let checked = 0;
  let found = 0;
  let marked = 0;
  const markedItems = [];
  const errors = [];

  for (const item of candidates) {
    checked += 1;
    try {
      const info = await fetchChaveCancellationInfo({
        httpsAgent,
        environment: env,
        chave: item.chave
      });
      if (!info.hasCancel) {
        await sleep(delayMs);
        continue;
      }
      found += 1;
      const result = await markSupabaseDocumentCancelledByChave({
        certificateId: certificate.id,
        environment: env,
        chave: item.chave,
        eventNsu: info.eventNsu,
        eventMeta: {
          ...(info.eventMeta || {}),
          source: 'scan_cancellations_api'
        }
      });
      if (result?.updated) {
        marked += Number(result.updated_count || 1);
        markedItems.push({
          nsu: item.nsu,
          numeroNfse: item.numeroNfse,
          chave: item.chave,
          eventNsu: info.eventNsu,
          motivo: info.eventMeta?.eventoMotivo || null
        });
      }
    } catch (err) {
      errors.push({ chave: item.chave, error: err.message });
    }
    await sleep(delayMs);
  }

  return {
    success: true,
    period: { startDate, endDate },
    candidates: candidates.length,
    checked,
    foundOnAdn: found,
    marked,
    markedItems: markedItems.slice(0, 50),
    errors: errors.slice(0, 20)
  };
}

/**
 * Datas padrao: mes civil corrente (UTC-3 aproximado via local do servidor).
 */
function currentMonthRange(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const fmt = d => {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  };
  return { startDate: fmt(start), endDate: fmt(end) };
}

module.exports = {
  scanCancellationsForPeriod,
  currentMonthRange
};
