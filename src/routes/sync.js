const express = require('express');
const https = require('https');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { IS_VERCEL, DOWNLOADS_DIR } = require('../config/constants');
const xmlCache = require('../utils/xmlCache');
const {
  getNationalApiBaseUrl,
  buildDfeUrl,
  isNationalApiFiscalStatus,
  getNationalApiStatus,
  formatNationalApiRejection,
  getResponseNsu,
  buildNationalApiContext,
  extractDfeDocuments,
  resolveCnpjConsulta,
  normalizeEnvironment
} = require('../services/nfse');
const {
  onlyDigits,
  validateCnpjConsultaRoot,
  getCertificateBuffer
} = require('../utils/cert');
const { validateCertificateForNationalApi } = require('../utils/certValidator');
const {
  resolveCertificateForRequest,
  syncSupabaseCertificate,
  startSupabaseRun,
  finishSupabaseRun,
  syncSupabaseState,
  syncSupabaseDocument,
  supabaseRpc
} = require('../services/supabase');
const { processBatchDocuments } = require('../services/documentProcessor');

const router = express.Router();

router.post('/clear-downloads', (req, res) => {
  try {
    let removedFiles = 0;
    if (!IS_VERCEL && fs.existsSync(DOWNLOADS_DIR)) {
      const files = fs.readdirSync(DOWNLOADS_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(DOWNLOADS_DIR, file));
      }
      removedFiles = files.length;
    }
    const cacheCount = xmlCache.size;
    xmlCache.clear();
    return res.json({ success: true, count: removedFiles + cacheCount });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Erro ao limpar pasta de downloads: ' + e.message });
  }
});

router.post('/fetch-batch', async (req, res) => {
  let selectedCertificate = null;
  let supabaseRunId = null;
  let requestStartNsu = 0;
  let requestEnvironment = 'producao';
  let requestCnpjConsulta = '';

  try {
    const { startNsu, environment, cnpjConsulta, sortOrder, certificateId } = req.body;
    requestStartNsu = Number(startNsu || 0);
    requestEnvironment = normalizeEnvironment(environment);
    requestCnpjConsulta = cnpjConsulta || '';
    
    if (startNsu === undefined || !environment) {
      return res.status(400).json({ success: false, error: 'Parâmetros startNsu e environment são obrigatórios.' });
    }

    selectedCertificate = await resolveCertificateForRequest(certificateId);
    if (!selectedCertificate) {
      return res.status(400).json({ success: false, error: 'Certificado não configurado ou não encontrado. Selecione um certificado antes da consulta.' });
    }

    requestCnpjConsulta = resolveCnpjConsulta(requestCnpjConsulta, selectedCertificate.cnpj);

    const cnpjRootError = validateCnpjConsultaRoot(requestCnpjConsulta, selectedCertificate.cnpj);
    if (cnpjRootError) {
      return res.status(400).json({ success: false, error: cnpjRootError });
    }

    await syncSupabaseCertificate(selectedCertificate, true);
    supabaseRunId = await startSupabaseRun({
      certificateId: selectedCertificate.id,
      environment: requestEnvironment,
      cnpjConsulta: requestCnpjConsulta,
      startNsu: requestStartNsu
    });

    const pfxBuffer = getCertificateBuffer(selectedCertificate);
    if (!pfxBuffer) {
      return res.status(400).json({ success: false, error: 'Arquivo ou variável do certificado não encontrada.' });
    }

    const certificateValidation = validateCertificateForNationalApi(pfxBuffer, selectedCertificate.passphrase);
    if (!certificateValidation.valid) {
      return res.status(400).json({ success: false, error: certificateValidation.error });
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
      return res.status(500).json({ success: false, error: 'Retorno vazio da API Nacional.' });
    }

    console.log(`Resposta HTTP ${response.status} | Chaves: ${Object.keys(data).join(', ')}`);
    console.log(`StatusProcessamento: ${data.StatusProcessamento || 'N/A'}`);

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

      return res.status(400).json({
        success: false,
        error: errorMsg,
        nationalApi: buildNationalApiContext(response, url, requestEnvironment, requestCnpjConsulta)
      });
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

    console.log(`Documentos encontrados na fila: ${documentsList.length} | ultNSU: ${ultNSU} | maxNSU: ${maxNSU}`);

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

    return res.json({
      success: true,
      ultNSU: ultNSU,
      maxNSU: maxNSU,
      totalFila: documentsList.length,
      menorDataLote: menorDataLote,
      maiorDataLote: maiorDataLote,
      documentos: processedDocs
    });

  } catch (e) {
    console.error('Erro na requisição à API da NFS-e:', e);

    if (e.response && e.response.status === 404) {
      const data = e.response.data;
      if (data && (data.StatusProcessamento === 'NENHUM_DOCUMENTO_LOCALIZADO' || 
                   (data.Erros && data.Erros.some(err => err.Codigo === 'E2220')))) {
        const fallbackNsu = req.body.startNsu !== undefined ? parseInt(req.body.startNsu) : 0;
        if (selectedCertificate) {
          await syncSupabaseState({
            certificateId: selectedCertificate.id,
            environment: requestEnvironment,
            cnpjConsulta: requestCnpjConsulta,
            lastNsu: fallbackNsu,
            maxNsuSeen: fallbackNsu,
            status: 'completed'
          });
          await finishSupabaseRun({
            runId: supabaseRunId,
            status: 'completed',
            endNsu: fallbackNsu,
            maxNsuSeen: fallbackNsu,
            documentsFound: 0
          });
        }
        return res.json({
          success: true,
          ultNSU: fallbackNsu,
          maxNSU: fallbackNsu,
          documentos: []
        });
      }
    }

    let errorMsg = e.message;
    if (e.response) {
      const nationalApiRejection = formatNationalApiRejection(e.response.data);
      if (nationalApiRejection) {
        errorMsg = nationalApiRejection;
      } else if (e.response.status === 496) {
        errorMsg = 'Erro 496: Certificado não fornecido ou inválido para o mTLS da Receita Federal.';
      } else if (e.response.status === 403) {
        errorMsg = 'Erro 403: Acesso Proibido. O certificado não tem permissão para este CNPJ ou o ambiente bloqueou a conexão.';
      } else if (e.response.status === 401) {
        errorMsg = 'Erro 401: Não autorizado. Verifique as credenciais do certificado.';
      } else if (e.response.status === 429 || e.response.status === 656) {
        errorMsg = 'Erro 429/656: Consumo Indevido. Aguarde 1 hora antes de consultar novamente.';
      } else {
        errorMsg = `Erro ${e.response.status} retornado pelo servidor nacional: ${JSON.stringify(e.response.data || '')}`;
      }
    }

    if (selectedCertificate) {
      const nextAllowedAt = /429|656|Consumo Indevido/i.test(errorMsg)
        ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
        : null;

      await syncSupabaseState({
        certificateId: selectedCertificate.id,
        environment: requestEnvironment,
        cnpjConsulta: requestCnpjConsulta,
        lastNsu: requestStartNsu,
        maxNsuSeen: requestStartNsu,
        status: 'error',
        nextAllowedAt,
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
    }

    return res.status(500).json({ success: false, error: errorMsg });
  }
});

router.post('/discover-nsu', async (req, res) => {
  try {
    const { environment, cnpjConsulta, certificateId } = req.body;
    const requestEnvironment = normalizeEnvironment(environment);
    let requestCnpjConsulta = cnpjConsulta || '';
    
    const selectedCertificate = await resolveCertificateForRequest(certificateId);
    requestCnpjConsulta = resolveCnpjConsulta(requestCnpjConsulta, selectedCertificate?.cnpj);
    if (!selectedCertificate) {
      return res.status(400).json({ success: false, error: 'Certificado não configurado ou não encontrado.' });
    }

    const cnpjRootError = validateCnpjConsultaRoot(requestCnpjConsulta, selectedCertificate.cnpj);
    if (cnpjRootError) {
      return res.status(400).json({ success: false, error: cnpjRootError });
    }

    const pfxBuffer = getCertificateBuffer(selectedCertificate);
    if (!pfxBuffer) {
      return res.status(400).json({ success: false, error: 'Arquivo ou variável do certificado não encontrada.' });
    }

    const certificateValidation = validateCertificateForNationalApi(pfxBuffer, selectedCertificate.passphrase);
    if (!certificateValidation.valid) {
      return res.status(400).json({ success: false, error: certificateValidation.error });
    }

    const httpsAgent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: selectedCertificate.passphrase,
      rejectUnauthorized: false
    });

    const baseUrl = getNationalApiBaseUrl(requestEnvironment);
    const url = buildDfeUrl(baseUrl, 0, requestCnpjConsulta);

    const response = await axios.get(url, {
      httpsAgent,
      timeout: 15000,
      validateStatus: isNationalApiFiscalStatus,
      headers: { 'Accept': 'application/json', 'User-Agent': 'NFS-e Batch Downloader Local' }
    });

    const data = response.data;
    if (!data) return res.status(500).json({ success: false, error: 'Retorno vazio' });

    const nationalStatus = getNationalApiStatus(data);
    if (nationalStatus === 'REJEICAO') {
      const errorMsg = formatNationalApiRejection(data) || 'Rejeicao da API Nacional sem detalhes.';
      return res.status(400).json({
        success: false,
        error: errorMsg,
        nationalApi: buildNationalApiContext(response, url, requestEnvironment, requestCnpjConsulta)
      });
    }

    if (nationalStatus === 'NENHUM_DOCUMENTO_LOCALIZADO') {
      return res.json({
        success: true,
        maxNSU: 0,
        reliableMax: true,
        nationalApi: buildNationalApiContext(response, url, requestEnvironment, requestCnpjConsulta)
      });
    }

    let maxNSU = getResponseNsu(data, ['maxNSU', 'MaxNSU', 'maxNsu', 'maiorNSU', 'MaiorNSU', 'UltimoNSU', 'ultimoNSU']);
    let reliableMax = maxNSU !== null;
    
    if (maxNSU === null) {
      const documentsList = extractDfeDocuments(data);
      if (documentsList.length > 0) {
        maxNSU = Math.max(...documentsList.map(d => d.NSU || d.nsu || 0));
        if (documentsList.length === 50) maxNSU += 1;
      }
    }

    return res.json({ success: true, maxNSU: maxNSU || 0, reliableMax });
  } catch (e) {
    console.error('Erro no discover-nsu:', e);
    
    if (e.response) {
      if (e.response.status === 404) {
        return res.json({ success: true, maxNSU: 0 });
      }

      const nationalApiRejection = formatNationalApiRejection(e.response.data);
      if (nationalApiRejection) {
        return res.status(500).json({ success: false, error: nationalApiRejection });
      }
      
      const data = e.response.data;
      if (data && data.Erros && data.Erros.length > 0) {
        const errorDesc = data.Erros.map(err => `${err.Codigo}: ${err.Descricao}`).join(' | ');
        return res.status(500).json({ success: false, error: `Rejeição da API Nacional: ${errorDesc}` });
      }
    }

    return res.status(500).json({ success: false, error: 'Erro ao descobrir NSU: ' + e.message });
  }
});

router.get('/sync-state', async (req, res) => {
  const { certificateId, environment = 'producao', cnpjConsulta = '' } = req.query;
  const selectedCertificate = await resolveCertificateForRequest(certificateId);

  if (!selectedCertificate) {
    return res.status(400).json({ success: false, error: 'Certificado não configurado ou não encontrado.' });
  }

  await syncSupabaseCertificate(selectedCertificate, true);
  const state = await supabaseRpc('xml_nfse_get_sync_state', {
    p_certificate_id: selectedCertificate.id,
    p_environment: normalizeEnvironment(environment),
    p_cnpj_consulta: cnpjConsulta || ''
  });

  return res.json({
    success: Boolean(state),
    state
  });
});

module.exports = router;
