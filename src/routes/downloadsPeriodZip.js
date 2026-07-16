const express = require('express');
const fs = require('fs');
const path = require('path');
const { DOWNLOADS_DIR, IS_VERCEL } = require('../config/constants');
const {
  listAllRemoteDocuments,
  getSupabaseXmlPayloads
} = require('../services/supabase');
const {
  MAX_ZIP_DOCUMENTS_VERCEL,
  MAX_ZIP_DOCUMENTS_LOCAL,
  dedupeXmlItems,
  getDocumentToken,
  resolveCertificateMetadataForList,
  buildListFilterParams
} = require('../utils/downloadHelpers');
const { registerAuditEvent, userEmailFromReq } = require('../services/audit');
const { sanitizeFileName, resolveContainedPath, safeErrorInfo } = require('../utils/security');

const router = express.Router();

router.post('/download-period-zip', async (req, res) => {
  try {
    // Evita incluir o custo de inicializacao do ZIP em toda chamada da API.
    const archiver = require('archiver');
    const {
      certificateId,
      environment = 'producao',
      startDate,
      endDate,
      cnpj,
      partyCnpj,
      partyRole,
      search = '',
      includeCancelled = 'false',
      onlyCancelled = 'false',
      cancelledMode = ''
    } = req.body;

    const cert = await resolveCertificateMetadataForList(certificateId);
    if (!cert) {
      return res.status(400).json({ success: false, error: 'Certificado não encontrado.' });
    }

    const filter = buildListFilterParams({
      environment, startDate, endDate, cnpj, partyCnpj, partyRole, search,
      includeCancelled, onlyCancelled, cancelledMode
    }, cert);

    const limitMax = IS_VERCEL ? MAX_ZIP_DOCUMENTS_VERCEL : MAX_ZIP_DOCUMENTS_LOCAL;
    const fullResult = await listAllRemoteDocuments(filter, { maxDocuments: limitMax + 1 });
    const totalMatched = Number(fullResult.total || (fullResult.documents || []).length);
    let documents = dedupeXmlItems(fullResult.documents || []);

    if (!documents || documents.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum documento no período.' });
    }

    if (totalMatched > limitMax || documents.length > limitMax) {
      return res.status(400).json({
        success: false,
        error: `O filtro atual encontrou ${totalMatched.toLocaleString('pt-BR')} XMLs. Limite sua busca a no máximo ${limitMax.toLocaleString('pt-BR')} por ZIP.`
      });
    }

    await registerAuditEvent({
      certificateId: cert.id,
      environment: filter.environment,
      nsu: null,
      fileName: 'NFS-e_Periodo_XMLs.zip',
      action: 'zip',
      userEmail: userEmailFromReq(req),
      details: {
        count: documents.length,
        startDate: startDate || null,
        endDate: endDate || null
      }
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=NFS-e_Periodo_XMLs.zip');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => {
      console.error('[period-zip:stream]', safeErrorInfo(err));
      if (!res.headersSent) {
        res.status(500).json({ error: 'Não foi possível gerar o arquivo ZIP.' });
      }
    });
    archive.pipe(res);

    const CHUNK_SIZE = 50;
    const validDocs = documents.filter(doc => (doc.file_name || doc.arquivo) && getDocumentToken(doc));

    for (let i = 0; i < validDocs.length; i += CHUNK_SIZE) {
      const chunk = validDocs.slice(i, i + CHUNK_SIZE);
      const tokens = chunk.map(doc => getDocumentToken(doc));

      const remotePayloads = await getSupabaseXmlPayloads(tokens);
      const payloadByToken = new Map(remotePayloads.map(payload => [payload.token, payload]));

      for (const doc of chunk) {
        const fileName = sanitizeFileName(doc.file_name || doc.arquivo, `NFSE_${doc.nsu || i}.xml`);
        const localPath = resolveContainedPath(DOWNLOADS_DIR, fileName);

        let xmlContent = null;
        if (!IS_VERCEL && fs.existsSync(localPath)) {
          xmlContent = fs.readFileSync(localPath, 'utf8');
        } else {
          const payload = payloadByToken.get(getDocumentToken(doc));
          if (payload && payload.xml_content) {
            xmlContent = payload.xml_content;
          }
        }

        if (xmlContent) {
          const minifiedXml = xmlContent.replace(/>\s+</g, '><').trim();
          archive.append(Buffer.from(minifiedXml, 'utf8'), { name: fileName });
        }
      }

      remotePayloads.length = 0;
      payloadByToken.clear();
    }

    await archive.finalize();
  } catch (err) {
    console.error('Erro ao gerar ZIP:', safeErrorInfo(err));
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Não foi possível gerar o arquivo ZIP.' });
    }
  }
});

module.exports = router;
