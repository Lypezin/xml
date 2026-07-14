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
  saveCertificatesIndex,
  writeEncryptedLocalCertificate
} = require('../services/localCertificates');
const {
  getCertificateBuffer,
  onlyDigits
} = require('../utils/cert');
const { validateCertificateForNationalApi } = require('../utils/certValidator');
const {
  MAX_CERTIFICATE_BYTES,
  sanitizeFileName,
  safeErrorInfo
} = require('../utils/security');

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_CERTIFICATE_BYTES,
    files: 1,
    fields: 4,
    fieldSize: 2048
  },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (extension !== '.pfx' && extension !== '.p12') {
      return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'pfx'));
    }
    return callback(null, true);
  }
});

function certificateUpload(req, res, next) {
  upload.single('pfx')(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      error: tooLarge
        ? 'O certificado excede o limite de 5 MB.'
        : 'Envie um único certificado válido nos formatos .pfx ou .p12.'
    });
  });
}

function validateUploadedPfx(pfxBuffer, passphrase, cnpjInput) {
  if (!pfxBuffer) {
    return { ok: false, status: 400, error: 'Arquivo do certificado é obrigatório.' };
  }
  if (!passphrase) {
    return { ok: false, status: 400, error: 'Senha do certificado é obrigatória.' };
  }

  try {
    new https.Agent({ pfx: pfxBuffer, passphrase });
  } catch (err) {
    return { ok: false, status: 400, error: 'Senha ou Certificado inválidos. Detalhes: ' + err.message };
  }

  const certificateValidation = validateCertificateForNationalApi(pfxBuffer, passphrase);
  if (!certificateValidation.valid) {
    return { ok: false, status: 400, error: certificateValidation.error };
  }

  const requestCnpj = onlyDigits(cnpjInput || '');
  if (cnpjInput && requestCnpj.length !== 14) {
    return { ok: false, status: 400, error: 'CNPJ informado no cadastro do certificado deve conter 14 digitos.' };
  }

  const resolvedCnpj = requestCnpj || certificateValidation.cnpj || '';
  if (!resolvedCnpj) {
    return {
      ok: false,
      status: 400,
      error: 'Nao foi possivel identificar com seguranca o CNPJ do titular no certificado. Informe manualmente o CNPJ da empresa ao cadastrar o A1.'
    };
  }

  return {
    ok: true,
    resolvedCnpj,
    certificateValidation
  };
}

function assertCnpjMatchesExisting(existingCnpj, newCnpj) {
  const prev = onlyDigits(existingCnpj || '');
  const next = onlyDigits(newCnpj || '');
  if (!prev) return { ok: true };
  if (prev !== next) {
    return {
      ok: false,
      status: 400,
      error: `O CNPJ do novo A1 (${next || 'não identificado'}) não confere com o certificado cadastrado (${prev}). A renovação mantém o vínculo do mesmo CNPJ e preserva XMLs/NSU.`
    };
  }
  return { ok: true };
}

router.post('/upload-certificate', certificateUpload, async (req, res) => {
  try {
    const pfxBuffer = req.file ? req.file.buffer : null;
    const passphrase = req.body.passphrase;
    const cnpj = req.body.cnpj || '';

    const validated = validateUploadedPfx(pfxBuffer, passphrase, cnpj);
    if (!validated.ok) {
      return res.status(validated.status).json({ success: false, error: validated.error });
    }
    const { resolvedCnpj, certificateValidation } = validated;
    const validUntil = certificateValidation?.validUntil || null;

    if (useRemoteCertificateStorage()) {
      const cert = {
        id: crypto.randomUUID(),
        originalName: sanitizeFileName(req.file.originalname, 'certificado.pfx'),
        cnpj: resolvedCnpj,
        validUntil,
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

      await syncSupabaseCertificate(cert, true);

      return res.json({
        success: true,
        message: 'Certificado salvo, criptografado e validado com sucesso!',
        activeCertificateId: cert.id,
        certificate: sanitizeCertificate(cert)
      });
    }

    const id = crypto.randomUUID();
    const safeOriginalName = sanitizeFileName(req.file.originalname, 'certificado.pfx');
    const storedName = writeEncryptedLocalCertificate(id, pfxBuffer, passphrase);

    const index = getCertificatesIndex();
    const cert = {
      id,
      originalName: safeOriginalName,
      storedName,
      encrypted: true,
      cnpj: resolvedCnpj,
      validUntil,
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
    console.error('Erro no upload do certificado:', safeErrorInfo(e));
    return res.status(500).json({ success: false, error: 'Não foi possível salvar o certificado.' });
  }
});

/**
 * Renova o PFX mantendo o mesmo certificate_id (XMLs, NSU, stats intactos).
 * Exige que o CNPJ do novo A1 seja o mesmo do cadastro atual.
 */
router.post('/renew-certificate', certificateUpload, async (req, res) => {
  try {
    const certificateId = String(req.body.certificateId || '').trim();
    const pfxBuffer = req.file ? req.file.buffer : null;
    const passphrase = req.body.passphrase;
    const cnpj = req.body.cnpj || '';

    if (!certificateId) {
      return res.status(400).json({ success: false, error: 'certificateId é obrigatório para renovar.' });
    }

    const validated = validateUploadedPfx(pfxBuffer, passphrase, cnpj);
    if (!validated.ok) {
      return res.status(validated.status).json({ success: false, error: validated.error });
    }
    const { resolvedCnpj } = validated;

    if (useRemoteCertificateStorage()) {
      const certificates = await listRemoteCertificates();
      const existing = certificates.find(item => item.id === certificateId);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Certificado não encontrado para renovação.' });
      }

      const cnpjCheck = assertCnpjMatchesExisting(existing.cnpj, resolvedCnpj);
      if (!cnpjCheck.ok) {
        return res.status(cnpjCheck.status).json({ success: false, error: cnpjCheck.error });
      }

      const keepCnpj = onlyDigits(existing.cnpj || '') || resolvedCnpj;
      const filename = sanitizeFileName(
        req.file.originalname || existing.filename || existing.originalName,
        'certificado.pfx'
      );

      const saved = await upsertRemoteCertificateSecret({
        id: certificateId,
        filename,
        cnpj: keepCnpj,
        active: Boolean(existing.active),
        pfxBuffer,
        passphrase
      });

      if (!saved || !saved.success) {
        return res.status(500).json({ success: false, error: 'Não foi possível renovar o certificado no Supabase.' });
      }

      const refreshed = await listRemoteCertificates();
      const updated = refreshed.find(item => item.id === certificateId) || {
        id: certificateId,
        originalName: filename,
        filename,
        cnpj: keepCnpj,
        active: Boolean(existing.active)
      };

      return res.json({
        success: true,
        renewed: true,
        message: 'Certificado renovado com sucesso. XMLs e NSU do mesmo vínculo foram preservados.',
        activeCertificateId: refreshed.find(c => c.active)?.id || certificateId,
        certificate: sanitizeCertificate(updated)
      });
    }

    const index = getCertificatesIndex();
    const cert = index.certificates.find(item => item.id === certificateId);
    if (!cert) {
      return res.status(404).json({ success: false, error: 'Certificado não encontrado para renovação.' });
    }

    const cnpjCheck = assertCnpjMatchesExisting(cert.cnpj, resolvedCnpj);
    if (!cnpjCheck.ok) {
      return res.status(cnpjCheck.status).json({ success: false, error: cnpjCheck.error });
    }

    const safeOriginalName = sanitizeFileName(req.file.originalname, cert.originalName || 'certificado.pfx');
    const oldPath = cert.storedName ? path.join(CERTS_DIR, cert.storedName) : null;
    const storedName = writeEncryptedLocalCertificate(certificateId, pfxBuffer, passphrase);
    if (oldPath && cert.storedName !== storedName && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (_) { /* ignore */ }
    }

    cert.originalName = safeOriginalName;
    cert.filename = cert.originalName;
    cert.storedName = storedName;
    cert.encrypted = true;
    delete cert.passphrase;
    cert.cnpj = onlyDigits(cert.cnpj || '') || resolvedCnpj;
    cert.updatedAt = new Date().toISOString();
    saveCertificatesIndex(index);

    await syncSupabaseCertificate(cert, index.activeCertificateId === certificateId);

    return res.json({
      success: true,
      renewed: true,
      message: 'Certificado renovado com sucesso. XMLs e NSU do mesmo vínculo foram preservados.',
      activeCertificateId: index.activeCertificateId,
      certificate: sanitizeCertificate(cert)
    });
  } catch (e) {
    console.error('Erro ao renovar certificado:', safeErrorInfo(e));
    return res.status(500).json({ success: false, error: 'Não foi possível renovar o certificado.' });
  }
});


module.exports = router;
