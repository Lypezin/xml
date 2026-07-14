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
const { safeErrorInfo } = require('../utils/security');

const router = express.Router();

/** Formata data/hora da ultima NFS-e para o card do dashboard. */
function formatDashboardLastUpdate(raw) {
  let lastUpdate = raw || 'Sem XMLs';
  if (!lastUpdate || lastUpdate === 'Sem XMLs') return 'Sem XMLs';

  const rawStr = String(lastUpdate).trim();

  // ISO com hora: 2026-07-10T13:36:01-03:00 ou 2026-07-10T13:36:01.000Z
  const isoMatch = rawStr.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (isoMatch) {
    const [, y, m, d, hh, mm] = isoMatch;
    return `${d}/${m}/${y} às ${hh}:${mm}`;
  }

  // So data: 2026-07-10
  const dateOnly = rawStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }

  // Ja formatado (dd/mm/yyyy ...)
  if (/^\d{2}\/\d{2}\/\d{4}/.test(rawStr)) {
    return rawStr;
  }

  return rawStr;
}

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
          return {
            certificateId: city.certificateId,
            filename: city.filename,
            cnpj: city.cnpj,
            active: Boolean(city.active),
            totalXmls: Number(city.totalXmls || 0),
            lastUpdate: formatDashboardLastUpdate(city.lastUpdate)
          };
        });

      return res.json({
        success: true,
        summary
      });
    } else {
      throw new Error('Banco de dados não retornou um formato de array.');
    }
  } catch (rpcErr) {
    console.error('RPC xml_nfse_get_dashboard_summary falhou:', safeErrorInfo(rpcErr));
    throw rpcErr;
  }
} catch (err) {
    console.error('Erro na rota /dashboard-summary:', safeErrorInfo(err));
    const detail = err.response?.data?.message || err.response?.data?.error || err.message;
    return res.status(500).json({
      success: false,
      error: 'Não foi possível carregar o resumo do dashboard.'
    });
  }
});

module.exports = router;
