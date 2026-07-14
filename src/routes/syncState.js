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

router.get('/sync-state', async (req, res) => {
  try {
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
  } catch (error) {
    console.error('[sync-state]', safeErrorInfo(error));
    return res.status(500).json({ success: false, error: 'Não foi possível carregar o estado da sincronização.' });
  }
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
    console.error('[reset-nsu]', safeErrorInfo(err));
    return res.status(500).json({ success: false, error: 'Não foi possível zerar o NSU.' });
  }
});

module.exports = router;
