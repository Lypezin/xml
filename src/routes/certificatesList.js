const express = require('express');
const {
  useRemoteCertificateStorage,
  listRemoteCertificates,
  setRemoteActiveCertificate
} = require('../services/supabase');
const {
  getCertificatesIndex,
  resolveCertificate,
  sanitizeCertificate,
  setActiveCertificate
} = require('../services/localCertificates');
const { getEnvCertificate } = require('../utils/cert');

const router = express.Router();

router.get('/certificate-status', async (req, res) => {
  if (useRemoteCertificateStorage()) {
    const certificates = await listRemoteCertificates();
    const envCert = getEnvCertificate();
    const allCertificates = certificates.length > 0 ? certificates : (envCert ? [sanitizeCertificate(envCert)] : []);
    const activeCert = allCertificates.find(cert => cert.active) || allCertificates[0] || null;

    return res.json({
      active: Boolean(activeCert),
      activeCertificateId: activeCert ? activeCert.id : null,
      filename: activeCert ? (activeCert.filename || activeCert.originalName || 'certificado.pfx') : null,
      cnpj: activeCert ? (activeCert.cnpj || 'Não cadastrado') : null,
      certificates: allCertificates.map(sanitizeCertificate)
    });
  }

  const index = getCertificatesIndex();
  const activeCert = resolveCertificate(index.activeCertificateId);

  return res.json({
    active: Boolean(activeCert),
    activeCertificateId: activeCert ? activeCert.id : null,
    filename: activeCert ? (activeCert.originalName || activeCert.filename || 'certificado.pfx') : null,
    cnpj: activeCert ? (activeCert.cnpj || 'Não cadastrado') : null,
    certificates: index.certificates.map(sanitizeCertificate)
  });
});

router.get('/certificates', async (req, res) => {
  if (useRemoteCertificateStorage()) {
    const certificates = await listRemoteCertificates();
    const envCert = getEnvCertificate();
    const allCertificates = certificates.length > 0 ? certificates : (envCert ? [sanitizeCertificate(envCert)] : []);
    const activeCert = allCertificates.find(cert => cert.active) || allCertificates[0] || null;

    return res.json({
      success: true,
      activeCertificateId: activeCert ? activeCert.id : null,
      certificates: allCertificates.map(sanitizeCertificate)
    });
  }

  const index = getCertificatesIndex();
  return res.json({
    success: true,
    activeCertificateId: index.activeCertificateId,
    certificates: index.certificates.map(sanitizeCertificate)
  });
});

router.post('/select-certificate', async (req, res) => {
  const { certificateId } = req.body || {};
  if (!certificateId) {
    return res.status(400).json({ success: false, error: 'certificateId é obrigatório.' });
  }

  if (useRemoteCertificateStorage()) {
    const selected = await setRemoteActiveCertificate(certificateId);
    if (!selected || !selected.success) {
      return res.status(404).json({ success: false, error: 'Certificado não encontrado.' });
    }

    const certificates = await listRemoteCertificates();
    const cert = certificates.find(item => item.id === certificateId);
    return res.json({
      success: true,
      activeCertificateId: certificateId,
      certificate: cert ? sanitizeCertificate(cert) : null
    });
  }

  const cert = setActiveCertificate(certificateId);
  if (!cert) {
    return res.status(404).json({ success: false, error: 'Certificado não encontrado.' });
  }

  await syncSupabaseCertificate(cert, true);

  return res.json({
    success: true,
    activeCertificateId: cert.id,
    certificate: sanitizeCertificate(cert)
  });
});

module.exports = router;
