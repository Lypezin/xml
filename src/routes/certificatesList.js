const express = require('express');
const {
  useRemoteCertificateStorage,
  listRemoteCertificates,
  setRemoteActiveCertificate,
  syncSupabaseCertificate,
  listRemoteDocuments
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

router.get('/dashboard-summary', async (req, res) => {
  try {
    let certificates = [];
    if (useRemoteCertificateStorage()) {
      certificates = await listRemoteCertificates();
      const envCert = getEnvCertificate();
      if (certificates.length === 0 && envCert) {
        certificates = [envCert];
      }
    } else {
      const index = getCertificatesIndex();
      certificates = index.certificates || [];
    }

    const summary = await Promise.all(
      certificates.map(async (cert) => {
        try {
          const result = await listRemoteDocuments({
            certificateId: cert.id,
            environment: 'producao',
            startDate: null,
            endDate: null,
            cnpj: '',
            partyCnpj: '',
            partyRole: 'tomador',
            search: '',
            includeCancelled: true,
            limit: 1,
            offset: 0
          });

          const latestDoc = result.documents?.[0];
          let lastUpdate = 'Sem XMLs';
          if (latestDoc && latestDoc.data_emissao) {
            const rawDate = String(latestDoc.data_emissao).split('T')[0];
            const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (match) {
              lastUpdate = `${match[3]}/${match[2]}/${match[1]}`;
            } else {
              lastUpdate = rawDate;
            }
          }

          return {
            certificateId: cert.id,
            filename: cert.filename || cert.originalName || 'certificado.pfx',
            cnpj: cert.cnpj || 'Não cadastrado',
            active: Boolean(cert.active),
            totalXmls: Number(result.total || 0),
            lastUpdate
          };
        } catch (err) {
          console.error(`Erro ao obter resumo para o certificado ${cert.id}:`, err);
          return {
            certificateId: cert.id,
            filename: cert.filename || cert.originalName || 'certificado.pfx',
            cnpj: cert.cnpj || 'Não cadastrado',
            active: Boolean(cert.active),
            totalXmls: 0,
            lastUpdate: 'Erro ao consultar'
          };
        }
      })
    );

    return res.json({
      success: true,
      summary
    });
  } catch (err) {
    console.error('Erro na rota /dashboard-summary:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
