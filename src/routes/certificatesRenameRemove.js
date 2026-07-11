const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

const { CERTS_DIR } = require('../config/constants');
const { getSettings, saveSettings } = require('../utils/settings');
const {
  useRemoteCertificateStorage,
  listRemoteCertificates,
  deleteRemoteCertificate,
  renameRemoteCertificate,
  upsertRemoteCertificateSecret,
  syncSupabaseCertificate
} = require('../services/supabase');
const {
  getCertificatesIndex,
  sanitizeCertificate,
  saveCertificatesIndex
} = require('../services/localCertificates');
const {
  getCertificateBuffer,
  onlyDigits
} = require('../utils/cert');
const { validateCertificateForNationalApi } = require('../utils/certValidator');

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post('/remove-certificate', async (req, res) => {
  try {
    const { certificateId } = req.body || {};
    if (useRemoteCertificateStorage()) {
      if (!certificateId) {
        return res.status(400).json({ success: false, error: 'certificateId é obrigatório para remover certificado remoto.' });
      }

      const removed = await deleteRemoteCertificate(certificateId);
      if (!removed || !removed.success) {
        return res.status(404).json({ success: false, error: 'Certificado não encontrado.' });
      }

      const certificates = await listRemoteCertificates();
      const activeCert = certificates.find(item => item.active) || certificates[0] || null;
      return res.json({
        success: true,
        activeCertificateId: activeCert ? activeCert.id : null,
        certificates: certificates.map(sanitizeCertificate)
      });
    }

    const index = getCertificatesIndex();
    const idToRemove = certificateId || index.activeCertificateId;
    const cert = index.certificates.find(item => item.id === idToRemove);

    if (!cert) {
      return res.status(404).json({ success: false, error: 'Certificado não encontrado.' });
    }

    const filePath = path.join(CERTS_DIR, cert.storedName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    index.certificates = index.certificates.filter(item => item.id !== idToRemove);
    if (index.activeCertificateId === idToRemove) {
      index.activeCertificateId = index.certificates[0] ? index.certificates[0].id : null;
    }
    saveCertificatesIndex(index);

    const settings = getSettings() || {};
    saveSettings({ ...settings, activeCertificateId: index.activeCertificateId });

    return res.json({
      success: true,
      activeCertificateId: index.activeCertificateId,
      certificates: index.certificates.map(sanitizeCertificate)
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Erro ao remover certificado: ' + e.message });
  }
});

router.post('/rename-certificate', async (req, res) => {
  try {
    const { certificateId, filename } = req.body || {};
    const nextName = String(filename || '').trim();

    if (!certificateId) {
      return res.status(400).json({ success: false, error: 'certificateId e obrigatorio.' });
    }
    if (!nextName) {
      return res.status(400).json({ success: false, error: 'Nome do certificado e obrigatorio.' });
    }

    if (useRemoteCertificateStorage()) {
      const renamed = await renameRemoteCertificate(certificateId, nextName);
      if (!renamed || renamed.success === false) {
        return res.status(404).json({ success: false, error: 'Certificado nao encontrado.' });
      }
      const certificates = await listRemoteCertificates();
      return res.json({
        success: true,
        certificate: sanitizeCertificate(renamed),
        certificates: certificates.map(sanitizeCertificate)
      });
    }

    const index = getCertificatesIndex();
    const cert = index.certificates.find(item => item.id === certificateId);
    if (!cert) {
      return res.status(404).json({ success: false, error: 'Certificado nao encontrado.' });
    }

    cert.originalName = nextName;
    cert.filename = nextName;
    cert.updatedAt = new Date().toISOString();
    saveCertificatesIndex(index);
    await syncSupabaseCertificate(cert, index.activeCertificateId === certificateId);

    return res.json({
      success: true,
      certificate: sanitizeCertificate(cert),
      certificates: index.certificates.map(sanitizeCertificate)
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Erro ao renomear certificado: ' + e.message });
  }
});

module.exports = router;
