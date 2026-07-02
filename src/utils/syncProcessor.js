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
    throw new Error('Retorno vazio da API Nacional.');
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

  const processedDocs = await processBatchDocuments({
    documentsList,
    selectedCertificate,
    requestEnvironment,
    xmlCache
  });

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

  for (const doc of processedDocs) {
    await syncSupabaseDocument({
      certificateId: selectedCertificate.id,
      environment: requestEnvironment,
      doc
    });
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
    documentos: processedDocs
  };
}

module.exports = {
  executeSyncBatch
};
