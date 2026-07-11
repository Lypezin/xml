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


module.exports = router;
