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

router.post('/upload-certificate', upload.single('pfx'), async (req, res) => {
  try {
    const pfxBuffer = req.file ? req.file.buffer : null;
    const passphrase = req.body.passphrase;
    const cnpj = req.body.cnpj || '';

    if (!pfxBuffer) {
      return res.status(400).json({ success: false, error: 'Arquivo do certificado é obrigatório.' });
    }
    if (!passphrase) {
      return res.status(400).json({ success: false, error: 'Senha do certificado é obrigatória.' });
    }

    try {
      new https.Agent({ pfx: pfxBuffer, passphrase: passphrase });
    } catch (err) {
      return res.status(400).json({ success: false, error: 'Senha ou Certificado inválidos. Detalhes: ' + err.message });
    }

    const certificateValidation = validateCertificateForNationalApi(pfxBuffer, passphrase);
    if (!certificateValidation.valid) {
      return res.status(400).json({ success: false, error: certificateValidation.error });
    }

    const requestCnpj = onlyDigits(cnpj);
    if (cnpj && requestCnpj.length !== 14) {
      return res.status(400).json({ success: false, error: 'CNPJ informado no cadastro do certificado deve conter 14 digitos.' });
    }

    const resolvedCnpj = requestCnpj || certificateValidation.cnpj || '';
    if (!resolvedCnpj) {
      return res.status(400).json({
        success: false,
        error: 'Nao foi possivel identificar com seguranca o CNPJ do titular no certificado. Informe manualmente o CNPJ da empresa ao cadastrar o A1.'
      });
    }

    if (useRemoteCertificateStorage()) {
      const cert = {
        id: crypto.randomUUID(),
        originalName: req.file.originalname || 'certificado.pfx',
        cnpj: resolvedCnpj,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const saved = await upsertRemoteCertificateSecret({
        id: cert.id,
        filename: cert.originalName,
        cnpj: resolvedCnpj,
        active: true,
        pfxBuffer,
        passphrase
      });

      if (!saved || !saved.success) {
        return res.status(500).json({ success: false, error: 'Não foi possível salvar o certificado criptografado no Supabase.' });
      }

      return res.json({
        success: true,
        message: 'Certificado salvo, criptografado e validado com sucesso!',
        activeCertificateId: cert.id,
        certificate: sanitizeCertificate(cert)
      });
    }

    const id = crypto.randomUUID();
    const extension = path.extname(req.file.originalname || '.pfx').toLowerCase();
    const storedName = `${id}${extension === '.p12' ? '.p12' : '.pfx'}`;
    fs.writeFileSync(path.join(CERTS_DIR, storedName), pfxBuffer);

    const index = getCertificatesIndex();
    const cert = {
      id,
      originalName: req.file.originalname || 'certificado.pfx',
      storedName,
      passphrase,
      cnpj: resolvedCnpj,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    index.certificates.push(cert);
    index.activeCertificateId = id;
    saveCertificatesIndex(index);

    const settings = getSettings() || {};
    saveSettings({ ...settings, activeCertificateId: id });

    await syncSupabaseCertificate(cert, true);

    return res.json({
      success: true,
      message: 'Certificado salvo e validado com sucesso!',
      activeCertificateId: id,
      certificate: sanitizeCertificate(cert)
    });
  } catch (e) {
    console.error('Erro no upload do certificado:', e);
    return res.status(500).json({ success: false, error: 'Erro interno no servidor: ' + e.message });
  }
});

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

module.exports = router;
