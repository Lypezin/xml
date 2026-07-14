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
const {
  scanCancellationsForPeriod,
  currentMonthRange
} = require('../services/cancellationScanner');

const router = express.Router();
const { safeErrorInfo } = require('../utils/security');

let fetchBatchInFlight = false;

router.post('/fetch-batch', async (req, res) => {
  const {
    startNsu,
    environment,
    cnpjConsulta,
    certificateId,
    sortOrder = 'asc',
    sessionRunId = null,
    closeRun
  } = req.body;
  const requestEnvironment = normalizeEnvironment(environment);
  const parsedStart = startNsu !== undefined ? parseInt(startNsu, 10) : 0;
  const requestStartNsu = Number.isFinite(parsedStart) ? parsedStart : 0;
  let requestCnpjConsulta = cnpjConsulta || '';

  // Sessão de UI: closeRun=false (run aberta do início ao fim).
  // Scheduler/legado: closeRun=true por padrão.
  const shouldCloseRun = closeRun === undefined
    ? !sessionRunId
    : Boolean(closeRun);

  let selectedCertificate = null;
  let supabaseRunId = sessionRunId || null;

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

    // Só cria nova run se não houver sessão aberta (scheduler / lote único)
    if (!supabaseRunId) {
      const runResult = await startSupabaseRun({
        certificateId: selectedCertificate.id,
        environment: requestEnvironment,
        cnpjConsulta: requestCnpjConsulta,
        startNsu: requestStartNsu
      });
      supabaseRunId = runResult ? (runResult.run_id || runResult) : null;
    }

    const result = await executeSyncBatch({
      selectedCertificate,
      requestEnvironment,
      requestStartNsu,
      requestCnpjConsulta,
      sortOrder,
      supabaseRunId,
      closeRun: shouldCloseRun
    });

    return res.json({ success: true, ...result, runId: supabaseRunId });

  } catch (e) {
    return handleSyncError({
      e,
      res,
      selectedCertificate,
      requestEnvironment,
      requestStartNsu,
      requestCnpjConsulta,
      supabaseRunId,
      closeRun: shouldCloseRun
    });
  } finally {
    fetchBatchInFlight = false;
  }
});

/** Abre uma run de sessão (início da varredura na UI). */
router.post('/sync-run/start', async (req, res) => {
  try {
    const { certificateId, environment, cnpjConsulta, startNsu } = req.body || {};
    const cert = await resolveCertificateForRequest(certificateId);
    if (!cert) {
      return res.status(400).json({ success: false, error: 'Certificado não encontrado.' });
    }
    const requestEnvironment = normalizeEnvironment(environment);
    const requestCnpj = onlyDigits(cnpjConsulta) || onlyDigits(cert.cnpj) || '';
    const runResult = await startSupabaseRun({
      certificateId: cert.id,
      environment: requestEnvironment,
      cnpjConsulta: requestCnpj,
      startNsu: Number(startNsu || 0)
    });
    const runId = runResult ? (runResult.run_id || runResult) : null;
    return res.json({ success: true, runId });
  } catch (err) {
    console.error('[sync-run/start]', safeErrorInfo(err));
    return res.status(500).json({ success: false, error: 'Não foi possível iniciar o registro da sincronização.' });
  }
});

/** Fecha a run de sessão (fim, pausa ou falha final). */
router.post('/sync-run/finish', async (req, res) => {
  try {
    const {
      runId,
      status = 'completed',
      endNsu = null,
      maxNsuSeen = null,
      documentsFound = 0,
      errorMessage = null
    } = req.body || {};
    if (!runId) {
      return res.status(400).json({ success: false, error: 'runId obrigatório.' });
    }
    const { finishSupabaseRun } = require('../services/supabase');
    await finishSupabaseRun({
      runId,
      status,
      endNsu,
      maxNsuSeen,
      documentsFound,
      errorMessage
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[sync-run/finish]', safeErrorInfo(err));
    return res.status(500).json({ success: false, error: 'Não foi possível finalizar o registro da sincronização.' });
  }
});

module.exports = router;
