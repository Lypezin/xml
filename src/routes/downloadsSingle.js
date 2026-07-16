const express = require('express');
const axios = require('axios');
const https = require('https');
const xmlCache = require('../utils/xmlCache');
const {
  getSupabaseXmlPayload,
} = require('../services/supabase');
const { registerAuditEvent, userEmailFromReq } = require('../services/audit');
const { resolveCertificateForRequest } = require('../services/localCertificates');
const { getCertificateBuffer, onlyDigits } = require('../utils/cert');
const {
  dedupeXmlItems,
  getDanfseBaseUrl,
  getDanfseFileName,
  summarizeRemoteError
} = require('../utils/downloadHelpers');
const { createNfseHttpsAgent, sanitizeFileName, safeErrorInfo } = require('../utils/security');

const router = express.Router();

router.get('/download-xml/:token', async (req, res) => {
  let cached = xmlCache.get(req.params.token);
  if (!cached) {
    const persisted = await getSupabaseXmlPayload(req.params.token);
    if (persisted && persisted.xml_content) {
      cached = {
        fileName: persisted.file_name,
        xmlString: persisted.xml_content,
        certificateId: persisted.certificate_id,
        environment: persisted.environment,
        nsu: persisted.nsu
      };
    }
  }

  if (!cached) {
    return res.status(404).json({ error: 'XML não encontrado nesta sessão. Faça a consulta novamente.' });
  }

  await registerAuditEvent({
    certificateId: cached.certificateId || null,
    environment: cached.environment || null,
    nsu: cached.nsu === undefined || cached.nsu === null ? null : Number(cached.nsu),
    fileName: cached.fileName,
    action: 'xml',
    userEmail: userEmailFromReq(req),
    details: { source: 'download-xml' }
  });

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  const downloadName = sanitizeFileName(cached.fileName, 'nfse.xml');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  return res.send(cached.xmlString);
});

router.get('/download-pdf/:chave', async (req, res) => {
  try {
    const chave = onlyDigits(req.params.chave);
    const environment = req.query.environment === 'homologacao' ? 'homologacao' : 'producao';

    if (chave.length !== 50) {
      return res.status(400).json({
        success: false,
        error: 'Chave de acesso NFS-e invalida. A chave nacional deve ter 50 digitos.'
      });
    }

    const cert = await resolveCertificateForRequest(req.query.certificateId);
    const pfx = getCertificateBuffer(cert);
    if (!cert || !pfx || !cert.passphrase) {
      return res.status(400).json({
        success: false,
        error: 'Certificado nao configurado para consultar o DANFSe.'
      });
    }

    const httpsAgent = createNfseHttpsAgent({
      pfx,
      passphrase: cert.passphrase
    });
    const url = `${getDanfseBaseUrl(environment)}/${encodeURIComponent(chave)}`;
    const response = await axios.get(url, {
      httpsAgent,
      responseType: 'arraybuffer',
      timeout: 45000,
      headers: {
        Accept: 'application/pdf,application/octet-stream,*/*',
        'User-Agent': 'XML-NFSe-Lote/1.0'
      },
      validateStatus: status => status < 500
    });

    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    const payload = Buffer.from(response.data || []);
    if (
      response.status >= 400 ||
      payload.length === 0 ||
      (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream'))
    ) {
      const detail = summarizeRemoteError(payload);
      return res.status(response.status >= 400 ? response.status : 502).json({
        success: false,
        error: `DANFSe nao retornou PDF para esta chave${detail ? `: ${detail}` : '.'}`
      });
    }

    const pdfName = getDanfseFileName(chave);
    await registerAuditEvent({
      certificateId: cert.id || null,
      environment,
      nsu: null,
      fileName: pdfName,
      action: 'pdf',
      userEmail: userEmailFromReq(req),
      details: { chave }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfName}"`);
    return res.send(payload);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = summarizeRemoteError(err.response?.data);
    console.error('Erro ao baixar DANFSe:', safeErrorInfo(err));
    return res.status(status).json({
      success: false,
      error: status < 500 && detail ? `A ADN recusou o DANFSe: ${detail}` : 'Não foi possível baixar o DANFSe.'
    });
  }
});

router.get('/download-zip', async (req, res) => {
  try {
    // O modulo de compressao so e necessario neste endpoint.
    const archiver = require('archiver');
    let payloads = Array.from(xmlCache.values()).map(cached => ({
      fileName: cached.fileName,
      xmlString: cached.xmlString
    }));

    if (payloads.length === 0) {
      return res.status(400).json({
        error: 'Nenhum XML disponível nesta sessão. Use o ZIP por período para baixar documentos persistidos.'
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=NFS-e_XMLs_Baixados.zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => {
      console.error('[session-zip:stream]', safeErrorInfo(err));
      if (!res.headersSent) {
        res.status(500).json({ error: 'Não foi possível gerar o arquivo ZIP.' });
      }
    });
    archive.pipe(res);

    for (const cached of dedupeXmlItems(payloads)) {
      archive.append(Buffer.from(cached.xmlString, 'utf8'), {
        name: sanitizeFileName(cached.fileName, 'nfse.xml')
      });
    }

    await archive.finalize();
  } catch (e) {
    console.error('Erro ao gerar arquivo ZIP:', safeErrorInfo(e));
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Não foi possível gerar o arquivo ZIP.' });
    }
  }
});

module.exports = router;
