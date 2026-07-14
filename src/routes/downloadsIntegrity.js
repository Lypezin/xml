const express = require('express');
const { IS_VERCEL } = require('../config/constants');
const { listAllRemoteDocuments } = require('../services/supabase');
const {
  MAX_EXCEL_DOCUMENTS_VERCEL,
  MAX_EXCEL_DOCUMENTS_LOCAL,
  dedupeXmlItems,
  resolveCertificateMetadataForList,
  buildListFilterParams
} = require('../utils/downloadHelpers');
const { registerAuditEvent, userEmailFromReq } = require('../services/audit');
const { safeErrorInfo } = require('../utils/security');

const router = express.Router();

function csvCell(value) {
  let text = value == null ? '' : String(value);
  // Evita formula injection ao abrir o manifesto no Excel/LibreOffice.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function manifestFileName(startDate, endDate) {
  const safe = value => String(value || '').replace(/[^0-9-]/g, '');
  const start = safe(startDate);
  const end = safe(endDate);
  if (start && end) return `Manifesto_Integridade_NFSe_${start}_a_${end}.csv`;
  return `Manifesto_Integridade_NFSe_${new Date().toISOString().slice(0, 10)}.csv`;
}

function documentManifestRow(doc) {
  const metadata = doc.metadata || {};
  const status = doc.is_cancelled || metadata.isCancellation
    ? 'Cancelada'
    : (metadata.status || doc.status || 'Autorizada');
  return [
    doc.nsu,
    doc.chave || metadata.chave,
    doc.numero_nfse || metadata.numeroNfse,
    status,
    doc.data_emissao || metadata.dataEmissaoCompleta || metadata.dataEmissao,
    doc.prestador_cnpj || metadata.prestadorCnpj,
    doc.prestador_nome || metadata.prestadorNome,
    doc.tomador_cnpj || metadata.tomadorCnpj,
    doc.tomador_nome || metadata.tomadorNome,
    doc.valor_servico ?? metadata.valorServico,
    doc.xml_sha256,
    doc.first_seen_at,
    doc.last_seen_at,
    doc.file_name
  ];
}

router.get('/download-integrity-manifest', async (req, res) => {
  try {
    const cert = await resolveCertificateMetadataForList(req.query.certificateId);
    if (!cert) {
      return res.status(400).json({ success: false, error: 'Certificado não encontrado.' });
    }

    const filter = buildListFilterParams(req.query, cert);
    const limitMax = IS_VERCEL ? MAX_EXCEL_DOCUMENTS_VERCEL : MAX_EXCEL_DOCUMENTS_LOCAL;
    const result = await listAllRemoteDocuments(filter, { maxDocuments: limitMax + 1 });
    const total = Number(result.total || result.documents?.length || 0);
    if (!result.documents?.length) {
      return res.status(400).json({ success: false, error: 'Nenhum documento encontrado.' });
    }
    if (total > limitMax || result.documents.length > limitMax) {
      return res.status(400).json({
        success: false,
        error: `O manifesto aceita no máximo ${limitMax.toLocaleString('pt-BR')} registros por exportação.`
      });
    }

    const documents = dedupeXmlItems(result.documents);
    const fileName = manifestFileName(req.query.startDate, req.query.endDate);
    await registerAuditEvent({
      certificateId: cert.id,
      environment: filter.environment,
      action: 'integrity_manifest',
      userEmail: userEmailFromReq(req),
      fileName,
      details: { count: documents.length, algorithm: 'SHA-256', format: 'CSV UTF-8' }
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.write('\uFEFF');
    res.write([
      'NSU', 'Chave de acesso', 'Número NFS-e', 'Status', 'Data de emissão',
      'CNPJ prestador', 'Prestador', 'CNPJ tomador', 'Tomador', 'Valor do serviço',
      'SHA-256 do XML', 'Primeiro registro', 'Última atualização', 'Arquivo'
    ].map(csvCell).join(';') + '\r\n');
    for (const doc of documents) {
      res.write(documentManifestRow(doc).map(csvCell).join(';') + '\r\n');
    }
    return res.end();
  } catch (error) {
    console.error('[integrity-manifest]', safeErrorInfo(error));
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Não foi possível gerar o manifesto de integridade.' });
    }
    return res.end();
  }
});

module.exports = router;
module.exports.csvCell = csvCell;
module.exports.documentManifestRow = documentManifestRow;
