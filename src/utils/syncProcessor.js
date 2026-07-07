const https = require('https');
const axios = require('axios');
const xmlCache = require('./xmlCache');
const {
  getNationalApiBaseUrl,
  buildDfeUrl,
  isNationalApiFiscalStatus,
  getNationalApiStatus,
  formatNationalApiRejection,
  getResponseNsu,
  extractDfeDocuments,
  normalizeEnvironment,
  buildNationalApiContext
} = require('../services/nfse');
const { validateCertificateForNationalApi } = require('./certValidator');
const { getCertificateBuffer } = require('./cert');
const {
  syncSupabaseState,
  finishSupabaseRun,
  syncSupabaseDocument
} = require('../services/supabase');
const { processBatchDocuments } = require('../services/documentProcessor');

function getDocumentDedupKey(doc) {
  const chave = String(doc.chave || '').trim();
  if (chave && chave !== 'N/A' && !chave.startsWith('NSU_')) {
    return `CHAVE:${chave}`;
  }
  return `NSU:${doc.nsu || doc.token || doc.arquivo || doc.xmlSha256 || 'SEM_CHAVE'}`;
}

function dedupeProcessedDocuments(docs) {
  const byKey = new Map();
  const ordered = [...(docs || [])].sort((a, b) => {
    const aEvento = String(a.tipo || '').toUpperCase() === 'EVENTO';
    const bEvento = String(b.tipo || '').toUpperCase() === 'EVENTO';
    return Number(aEvento) - Number(bEvento);
  });
  for (const doc of ordered) {
    const key = getDocumentDedupKey(doc);
    if (!byKey.has(key)) byKey.set(key, doc);
  }
  return Array.from(byKey.values());
}

async function executeSyncBatch({ selectedCertificate, requestEnvironment, requestStartNsu, requestCnpjConsulta, sortOrder, supabaseRunId }) {
  const pfxBuffer = getCertificateBuffer(selectedCertificate);
  if (!pfxBuffer) {
    throw new Error('Arquivo ou variável do certificado não encontrada.');
  }

  const certValidation = validateCertificateForNationalApi(pfxBuffer, selectedCertificate.passphrase);
  if (!certValidation.valid) {
    throw new Error(certValidation.error);
  }

  const httpsAgent = new https.Agent({
    pfx: pfxBuffer,
    passphrase: selectedCertificate.passphrase,
    rejectUnauthorized: false
  });

  const baseUrl = getNationalApiBaseUrl(requestEnvironment);
  const url = buildDfeUrl(baseUrl, requestStartNsu, requestCnpjConsulta);
  console.log(`Fazendo requisição à API Nacional: ${url}`);

  const response = await axios.get(url, {
    httpsAgent,
    timeout: 15000,
    validateStatus: isNationalApiFiscalStatus,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'NFS-e Batch Downloader Local'
    }
  });

  const data = response.data;
  if (!data) {
    const err = new Error('Retorno vazio temporario da API Nacional.');
    err.isTransient = true;
    err.nationalApi = buildNationalApiContext(response, url, requestEnvironment, requestCnpjConsulta);
    throw err;
  }

  console.log(`Resposta HTTP ${response.status} | Chaves: ${Object.keys(data).join(', ')}`);
  
  const nationalStatus = getNationalApiStatus(data);
  if (nationalStatus === 'REJEICAO') {
    const errorMsg = formatNationalApiRejection(data) || 'Rejeicao da API Nacional sem detalhes.';
    
    await syncSupabaseState({
      certificateId: selectedCertificate.id,
      environment: requestEnvironment,
      cnpjConsulta: requestCnpjConsulta,
      lastNsu: requestStartNsu,
      maxNsuSeen: requestStartNsu,
      status: 'error',
      lastError: errorMsg
    });
    await finishSupabaseRun({
      runId: supabaseRunId,
      status: 'error',
      endNsu: requestStartNsu,
      maxNsuSeen: requestStartNsu,
      documentsFound: 0,
      errorMessage: errorMsg
    });

    const err = new Error(errorMsg);
    err.nationalApi = buildNationalApiContext(response, url, requestEnvironment, requestCnpjConsulta);
    err.isRejection = true;
    throw err;
  }

  let ultNSU = getResponseNsu(data, ['ultNSU', 'UltNSU', 'ultNsu', 'UltimoNSU', 'ultimoNSU']);
  let maxNSU = getResponseNsu(data, ['maxNSU', 'MaxNSU', 'maxNsu', 'maiorNSU', 'MaiorNSU']);
  const documentsList = extractDfeDocuments(data);

  if (ultNSU === null && documentsList.length > 0) {
    const nsus = documentsList.map(d => d.NSU || d.nsu || 0);
    ultNSU = Math.max(...nsus);
  }
  if (ultNSU === null) ultNSU = requestStartNsu;
  if (maxNSU === null) {
    maxNSU = documentsList.length === 50 ? ultNSU + 1 : ultNSU;
  }

  console.log(`Documentos encontrados: ${documentsList.length} | ultNSU: ${ultNSU} | maxNSU: ${maxNSU}`);

  const processedDocs = dedupeProcessedDocuments(await processBatchDocuments({
    documentsList,
    selectedCertificate,
    requestEnvironment,
    requestCnpjConsulta,
    xmlCache
  }));

  let menorDataLote = null;
  let maiorDataLote = null;

  if (processedDocs.length > 0) {
    const datas = processedDocs
      .map(d => d.dataEmissao)
      .filter(d => d !== 'N/A' && d);
      
    if (datas.length > 0) {
      datas.sort();
      menorDataLote = datas[0];
      maiorDataLote = datas[datas.length - 1];
    }
  }

  processedDocs.sort((a, b) => {
    const aNsu = Number(a.nsu || 0);
    const bNsu = Number(b.nsu || 0);
    return sortOrder === 'desc' ? bNsu - aNsu : aNsu - bNsu;
  });

  let newDocuments = 0;
  let existingDocuments = 0;
  const insertedKeys = [];

  for (const doc of processedDocs) {
    const savedDoc = await syncSupabaseDocument({
      certificateId: selectedCertificate.id,
      environment: requestEnvironment,
      doc
    });
    if (savedDoc?.inserted) {
      newDocuments += 1;
      if (doc.chave && doc.chave !== 'N/A' && String(doc.tipo).toUpperCase() !== 'EVENTO') {
        insertedKeys.push(doc.chave);
      }
    } else {
      existingDocuments += 1;
    }
  }

  await syncSupabaseState({
    certificateId: selectedCertificate.id,
    environment: requestEnvironment,
    cnpjConsulta: requestCnpjConsulta,
    lastNsu: ultNSU,
    maxNsuSeen: maxNSU,
    status: ultNSU >= maxNSU ? 'completed' : 'running'
  });

  await finishSupabaseRun({
    runId: supabaseRunId,
    status: 'completed',
    endNsu: ultNSU,
    maxNsuSeen: maxNSU,
    documentsFound: processedDocs.length
  });

  return {
    ultNSU,
    maxNSU,
    totalFila: documentsList.length,
    menorDataLote,
    maiorDataLote,
    novos: newDocuments,
    existentes: existingDocuments,
    documentos: processedDocs,
    insertedKeys
  };
}

module.exports = {
  executeSyncBatch
};
