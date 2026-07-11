const express = require('express');
const archiver = require('archiver');
const axios = require('axios');
const https = require('https');
const xmlCache = require('../utils/xmlCache');
const {
  supabaseRpc,
  getSupabaseXmlPayload,
  listSupabaseXmlPayloads
} = require('../services/supabase');
const { resolveCertificateForRequest } = require('../services/localCertificates');
const { getCertificateBuffer, onlyDigits } = require('../utils/cert');
const {
  dedupeXmlItems,
  getDanfseBaseUrl,
  getDanfseFileName,
  summarizeRemoteError
} = require('../utils/downloadHelpers');

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

  await supabaseRpc('xml_nfse_register_download', {
    p_certificate_id: cached.certificateId || null,
    p_environment: cached.environment || null,
    p_nsu: cached.nsu === undefined || cached.nsu === null ? null : Number(cached.nsu),
    p_file_name: cached.fileName
  });

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${cached.fileName}"`);
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

    const httpsAgent = new https.Agent({
      pfx,
      passphrase: cert.passphrase,
      rejectUnauthorized: false
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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${getDanfseFileName(chave)}"`);
    return res.send(payload);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = summarizeRemoteError(err.response?.data);
    console.error('Erro ao baixar DANFSe:', detail || err.message);
    return res.status(status).json({
      success: false,
      error: `Erro ao baixar DANFSe${detail ? `: ${detail}` : `: ${err.message}`}`
    });
  }
});

router.get('/download-zip', async (req, res) => {
  try {
    let payloads = Array.from(xmlCache.values()).map(cached => ({
      fileName: cached.fileName,
      xmlString: cached.xmlString
    }));

    if (payloads.length === 0) {
      const persistedPayloads = await listSupabaseXmlPayloads();
      if (Array.isArray(persistedPayloads)) {
        payloads = persistedPayloads.map(item => ({
          fileName: item.file_name,
          xmlString: item.xml_content
        }));
      }
    }

    if (payloads.length === 0) {
      return res.status(400).json({ error: 'Nenhum XML consultado nesta sessão para compactar.' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=NFS-e_XMLs_Baixados.zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => {
      console.error('Archive stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro no stream do ZIP: ' + err.message });
      }
    });
    archive.pipe(res);

    for (const cached of dedupeXmlItems(payloads)) {
      archive.append(Buffer.from(cached.xmlString, 'utf8'), { name: cached.fileName });
    }

    await archive.finalize();
  } catch (e) {
    console.error('Erro ao gerar arquivo ZIP:', e);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Erro ao gerar arquivo ZIP: ' + e.message });
    }
  }
});

module.exports = router;
