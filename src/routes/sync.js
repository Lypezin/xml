const express = require('express');
const https = require('https');
const axios = require('axios');

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
const {
  onlyDigits,
  validateCnpjConsultaRoot
} = require('../utils/cert');
const { validateCertificateForNationalApi } = require('../utils/certValidator');
const { resolveCertificateForRequest } = require('../services/localCertificates');
const {
  syncSupabaseCertificate,
  startSupabaseRun,
  supabaseRpc
} = require('../services/supabase');
const { executeSyncBatch } = require('../utils/syncProcessor');
const { handleSyncError } = require('../utils/syncErrorHandler');

const router = express.Router();
let fetchBatchInFlight = false;

router.post('/fetch-batch', async (req, res) => {
  const { startNsu, environment, cnpjConsulta, certificateId, sortOrder = 'asc' } = req.body;
  const requestEnvironment = normalizeEnvironment(environment);
  const parsedStart = startNsu !== undefined ? parseInt(startNsu, 10) : 0;
  const requestStartNsu = Number.isFinite(parsedStart) ? parsedStart : 0;
  let requestCnpjConsulta = cnpjConsulta || '';

  let selectedCertificate = null;
  let supabaseRunId = null;

  if (fetchBatchInFlight) {
    return res.status(409).json({
      success: false,
      error: 'Já existe uma varredura em andamento neste servidor. Aguarde o lote atual terminar.',
      retryable: true
    });
  }

  fetchBatchInFlight = true;

  try {
    selectedCertificate = await resolveCertificateForRequest(certificateId);
    requestCnpjConsulta = onlyDigits(requestCnpjConsulta) || onlyDigits(selectedCertificate?.cnpj) || '';

    if (!selectedCertificate) {
      return res.status(400).json({ success: false, error: 'Certificado não configurado ou não encontrado.' });
    }

    const cnpjRootError = validateCnpjConsultaRoot(requestCnpjConsulta, selectedCertificate.cnpj);
    if (cnpjRootError) {
      return res.status(400).json({ success: false, error: cnpjRootError });
    }

    // Respeita cooldown de consumo indevido (429/656)
    const existingState = await supabaseRpc('xml_nfse_get_sync_state', {
      p_certificate_id: selectedCertificate.id,
      p_environment: requestEnvironment,
      p_cnpj_consulta: requestCnpjConsulta
    });
    if (existingState?.next_allowed_at) {
      const nextAllowed = new Date(existingState.next_allowed_at).getTime();
      if (Number.isFinite(nextAllowed) && Date.now() < nextAllowed) {
        return res.status(429).json({
          success: false,
          error: `Consumo indevido: aguarde até ${existingState.next_allowed_at} antes de nova consulta no ADN.`,
          retryable: true,
          nextAllowedAt: existingState.next_allowed_at
        });
      }
    }

    await syncSupabaseCertificate(selectedCertificate, true);

    const runResult = await startSupabaseRun({
      certificateId: selectedCertificate.id,
      environment: requestEnvironment,
      cnpjConsulta: requestCnpjConsulta,
      startNsu: requestStartNsu
    });
    supabaseRunId = runResult ? (runResult.run_id || runResult) : null;

    const result = await executeSyncBatch({
      selectedCertificate,
      requestEnvironment,
      requestStartNsu,
      requestCnpjConsulta,
      sortOrder,
      supabaseRunId
    });

    return res.json({ success: true, ...result });

  } catch (e) {
    return handleSyncError({
      e,
      res,
      selectedCertificate,
      requestEnvironment,
      requestStartNsu,
      requestCnpjConsulta,
      supabaseRunId
    });
  } finally {
    fetchBatchInFlight = false;
  }
});

router.post('/discover-nsu', async (req, res) => {
  try {
    const { environment, cnpjConsulta, certificateId } = req.body;
    const requestEnvironment = normalizeEnvironment(environment);
    
    const selectedCertificate = await resolveCertificateForRequest(certificateId);
    const requestCnpjConsulta = onlyDigits(cnpjConsulta) || onlyDigits(selectedCertificate?.cnpj) || '';
    
    if (!selectedCertificate) {
      return res.status(400).json({ success: false, error: 'Certificado não configurado ou não encontrado.' });
    }

    const cnpjRootError = validateCnpjConsultaRoot(requestCnpjConsulta, selectedCertificate.cnpj);
    if (cnpjRootError) return res.status(400).json({ success: false, error: cnpjRootError });

    const pfxBuffer = selectedCertificate.pfxBuffer || (selectedCertificate.filePath ? require('fs').readFileSync(selectedCertificate.filePath) : null);
    if (!pfxBuffer) return res.status(400).json({ success: false, error: 'Arquivo do certificado não encontrado.' });

    const certValidation = validateCertificateForNationalApi(pfxBuffer, selectedCertificate.passphrase);
    if (!certValidation.valid) return res.status(400).json({ success: false, error: certValidation.error });

    const httpsAgent = new https.Agent({ pfx: pfxBuffer, passphrase: selectedCertificate.passphrase, rejectUnauthorized: false });
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
      return res.status(400).json({
        success: false,
        error: formatNationalApiRejection(data) || 'Rejeição da API Nacional.',
        nationalApi: buildNationalApiContext(response, url, requestEnvironment, requestCnpjConsulta)
      });
    }

    if (nationalStatus === 'NENHUM_DOCUMENTO_LOCALIZADO') {
      return res.json({ success: true, maxNSU: 0, reliableMax: true });
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
    if (e.response && e.response.status === 404) return res.json({ success: true, maxNSU: 0 });
    return res.status(500).json({ success: false, error: 'Erro ao descobrir NSU: ' + e.message });
  }
});

router.get('/sync-state', async (req, res) => {
  const { certificateId, environment = 'producao', cnpjConsulta = '' } = req.query;

  // Path leve: nao carrega/descriptografa PFX — so metadados + RPCs de estado
  const { listRemoteCertificates } = require('../services/supabase');
  const remoteCerts = await listRemoteCertificates();
  let certMeta = null;
  if (Array.isArray(remoteCerts) && remoteCerts.length > 0) {
    certMeta = certificateId
      ? remoteCerts.find(c => c.id === certificateId)
      : (remoteCerts.find(c => c.active) || remoteCerts[0]);
  }

  // Fallback local sem forcar decrypt remoto se nao houver no Supabase
  if (!certMeta) {
    const selectedCertificate = await resolveCertificateForRequest(certificateId);
    if (!selectedCertificate) {
      return res.status(400).json({ success: false, error: 'Certificado não configurado ou não encontrado.' });
    }
    certMeta = {
      id: selectedCertificate.id,
      cnpj: selectedCertificate.cnpj || ''
    };
  }

  const requestCnpjConsulta = onlyDigits(cnpjConsulta) || onlyDigits(certMeta?.cnpj) || '';
  const env = normalizeEnvironment(environment);

  const [state, lastReceived] = await Promise.all([
    supabaseRpc('xml_nfse_get_sync_state', {
      p_certificate_id: certMeta.id,
      p_environment: env,
      p_cnpj_consulta: requestCnpjConsulta
    }),
    supabaseRpc('xml_nfse_get_last_received_nsu', {
      p_certificate_id: certMeta.id,
      p_environment: env,
      p_cnpj_consulta: requestCnpjConsulta
    })
  ]);

  return res.json({
    success: Boolean(state),
    state: state ? { ...state, last_received_nsu: Number(lastReceived || 0) } : state,
    cnpjConsulta: requestCnpjConsulta
  });
});

router.post('/reset-nsu', async (req, res) => {
  try {
    const { certificateId, environment, cnpjConsulta } = req.body;
    
    if (!certificateId) {
      return res.status(400).json({ success: false, error: 'certificateId é obrigatório.' });
    }

    const selectedCertificate = await resolveCertificateForRequest(certificateId);
    if (!selectedCertificate) {
      return res.status(400).json({ success: false, error: 'Certificado não encontrado.' });
    }

    const requestCnpjConsulta = onlyDigits(cnpjConsulta) || onlyDigits(selectedCertificate?.cnpj) || '';
    const requestEnvironment = normalizeEnvironment(environment);

    await supabaseRpc('xml_nfse_update_sync_state', {
      p_certificate_id: selectedCertificate.id,
      p_environment: requestEnvironment,
      p_cnpj_consulta: requestCnpjConsulta,
      p_last_nsu: 0,
      p_max_nsu_seen: 0,
      p_status: 'idle'
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('Erro ao zerar NSU no Supabase:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
