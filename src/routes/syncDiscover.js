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

module.exports = router;
