const express = require('express');
const { getCertificateEncryptionKeyDiagnostics } = require('../utils/crypto');
const {
  useRemoteCertificateStorage,
  resolveRemoteCertificate
} = require('../services/supabase');
const {
  resolveCertificateForRequest,
  sanitizeCertificate
} = require('../services/localCertificates');
const {
  getCertificateBuffer
} = require('../utils/cert');
const { validateCertificateForNationalApi } = require('../utils/certValidator');
const { normalizeEnvironment, getNationalApiBaseUrl } = require('../services/nfse');
const { safeErrorInfo } = require('../utils/security');

const router = express.Router();

router.get('/certificate-diagnostics', async (req, res) => {
  const environment = normalizeEnvironment(req.query.environment || 'producao');
  const certificateId = req.query.certificateId || null;

  try {
    const selectedCertificate = await resolveCertificateForRequest(certificateId);
    if (!selectedCertificate) {
      return res.status(400).json({
        success: false,
        remoteStorage: useRemoteCertificateStorage(),
        encryptionKey: getCertificateEncryptionKeyDiagnostics(),
        environment,
        nationalApiBaseUrl: getNationalApiBaseUrl(environment),
        error: 'Certificado nao configurado ou nao encontrado.'
      });
    }

    const pfxBuffer = getCertificateBuffer(selectedCertificate);
    if (!pfxBuffer) {
      return res.status(400).json({
        success: false,
        remoteStorage: useRemoteCertificateStorage(),
        encryptionKey: getCertificateEncryptionKeyDiagnostics(),
        environment,
        nationalApiBaseUrl: getNationalApiBaseUrl(environment),
        certificate: sanitizeCertificate(selectedCertificate),
        error: 'Arquivo ou variavel do certificado nao encontrada.'
      });
    }

    const certificateValidation = validateCertificateForNationalApi(pfxBuffer, selectedCertificate.passphrase);

    return res.json({
      success: certificateValidation.valid,
      remoteStorage: useRemoteCertificateStorage(),
      encryptionKey: getCertificateEncryptionKeyDiagnostics(),
      environment,
      nationalApiBaseUrl: getNationalApiBaseUrl(environment),
      certificate: sanitizeCertificate(selectedCertificate),
      pfx: {
        decryptable: true,
        valid: certificateValidation.valid,
        subject: certificateValidation.subject || null,
        cnpjExtracted: certificateValidation.cnpj || null,
        certificatesInPfx: certificateValidation.certificatesInPfx || null,
        validUntil: certificateValidation.validUntil || null,
        error: certificateValidation.error || null
      }
    });
  } catch (e) {
    console.error('[certificate-diagnostics]', safeErrorInfo(e));
    return res.status(500).json({
      success: false,
      remoteStorage: useRemoteCertificateStorage(),
      encryptionKey: getCertificateEncryptionKeyDiagnostics(),
      environment,
      nationalApiBaseUrl: getNationalApiBaseUrl(environment),
      error: 'Falha interna ao diagnosticar o certificado.'
    });
  }
});

module.exports = router;
