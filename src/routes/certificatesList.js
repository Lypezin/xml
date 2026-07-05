const express = require('express');
const {
  useRemoteCertificateStorage,
  listRemoteCertificates,
  setRemoteActiveCertificate,
  syncSupabaseCertificate,
  listRemoteDocuments
} = require('../services/supabase');
const { supabaseRpc } = require('../services/supabaseClient');
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
    try {
      const summaryData = await supabaseRpc('xml_nfse_get_dashboard_summary', {});
      if (Array.isArray(summaryData)) {
        const summary = summaryData.map(city => {
          let lastUpdate = city.lastUpdate || 'Sem XMLs';
          if (lastUpdate && lastUpdate !== 'Sem XMLs') {
            const rawStr = String(lastUpdate).trim();
            if (rawStr.includes('T')) {
              const parts = rawStr.split('T');
              const datePart = parts[0];
              const timePart = parts[1].split(/[-+Z]/)[0];
              const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
              if (match) {
                lastUpdate = `${match[3]}/${match[2]}/${match[1]} às ${timePart}`;
              } else {
                lastUpdate = `${datePart} às ${timePart}`;
              }
            } else {
              const match = rawStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
              if (match) {
                lastUpdate = `${match[3]}/${match[2]}/${match[1]}`;
              }
            }
          }

          return {
            certificateId: city.certificateId,
            filename: city.filename,
            cnpj: city.cnpj,
            active: Boolean(city.active),
            totalXmls: Number(city.totalXmls || 0),
            lastUpdate
          };
        });

        return res.json({
          success: true,
          summary
        });
      }
    } catch (rpcErr) {
      console.warn('RPC xml_nfse_get_dashboard_summary não encontrado ou falhou, usando fallback local:', rpcErr.message);
    }

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

    const summary = certificates.map((cert) => {
      return {
        certificateId: cert.id,
        filename: cert.filename || cert.originalName || 'certificado.pfx',
        cnpj: cert.cnpj || 'Não cadastrado',
        active: Boolean(cert.active),
        totalXmls: 0,
        lastUpdate: 'Atualize o SQL no Supabase para ver os dados'
      };
    });

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
