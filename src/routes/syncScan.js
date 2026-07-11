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

let cancelScanInFlight = false;

router.post('/scan-cancellations', async (req, res) => {
  if (cancelScanInFlight) {
    return res.status(409).json({
      success: false,
      error: 'Ja existe uma verificacao de canceladas em andamento.',
      retryable: true
    });
  }

  cancelScanInFlight = true;
  try {
    const {
      certificateId,
      environment = 'producao',
      startDate,
      endDate,
      maxKeys = 80
    } = req.body || {};

    const certificate = await resolveCertificateForRequest(certificateId);
    if (!certificate) {
      return res.status(400).json({ success: false, error: 'Certificado nao configurado.' });
    }

    const range = (startDate && endDate)
      ? { startDate, endDate }
      : currentMonthRange();

    const result = await scanCancellationsForPeriod({
      certificate,
      environment: normalizeEnvironment(environment),
      startDate: range.startDate,
      endDate: range.endDate,
      maxKeys: Number(maxKeys) || 80,
      delayMs: 400
    });

    return res.json(result);
  } catch (err) {
    console.error('Erro em scan-cancellations:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    cancelScanInFlight = false;
  }
});

module.exports = router;
