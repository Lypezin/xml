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

module.exports = router;
