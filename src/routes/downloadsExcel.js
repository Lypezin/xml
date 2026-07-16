const express = require('express');
const { IS_VERCEL } = require('../config/constants');
const { listAllRemoteDocuments } = require('../services/supabase');
const {
  MAX_EXCEL_DOCUMENTS_VERCEL,
  MAX_EXCEL_DOCUMENTS_LOCAL,
  dedupeXmlItems,
  formatCnpj,
  formatDateBr,
  resolveCertificateMetadataForList,
  buildListFilterParams
} = require('../utils/downloadHelpers');
const { styleDataRow } = require('../utils/excelRowStyle');
const { registerAuditEvent, userEmailFromReq } = require('../services/audit');
const { safeErrorInfo } = require('../utils/security');

const router = express.Router();

/** YYYY-MM-DD -> DD-MM-YYYY para nome de arquivo legível */
function formatDateForFileName(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw.replace(/[^\w.-]+/g, '_');
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function buildExcelFileName(startDate, endDate) {
  const start = formatDateForFileName(startDate);
  const end = formatDateForFileName(endDate);
  if (start && end) return `Notas_NFSe_${start}_a_${end}.xlsx`;
  if (start) return `Notas_NFSe_desde_${start}.xlsx`;
  if (end) return `Notas_NFSe_ate_${end}.xlsx`;
  return 'Notas_NFSe.xlsx';
}

router.get('/download-excel', async (req, res) => {
  try {
    // ExcelJS e pesado; carregue somente quando este export for solicitado.
    const ExcelJS = require('exceljs');
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
    } = req.query;

    const cert = await resolveCertificateMetadataForList(certificateId);
    if (!cert) {
      return res.status(400).json({ success: false, error: 'Certificado não encontrado.' });
    }

    const filter = buildListFilterParams({
      environment, startDate, endDate, cnpj, partyCnpj, partyRole, search,
      includeCancelled, onlyCancelled, cancelledMode
    }, cert);

    const limitMax = IS_VERCEL ? MAX_EXCEL_DOCUMENTS_VERCEL : MAX_EXCEL_DOCUMENTS_LOCAL;

    // Pagina a RPC (teto 100/500 por página) até reunir todos os XMLs do filtro
    const fullResult = await listAllRemoteDocuments(filter, { maxDocuments: limitMax + 1 });
    const totalMatched = Number(fullResult.total || (fullResult.documents || []).length);

    if (totalMatched === 0 || !(fullResult.documents || []).length) {
      return res.status(400).json({ success: false, error: 'Nenhum documento encontrado.' });
    }

    if (totalMatched > limitMax || (fullResult.documents || []).length > limitMax) {
      return res.status(400).json({
        success: false,
        error: `O filtro atual encontrou ${totalMatched.toLocaleString('pt-BR')} documentos. Para baixar Excel, limite sua busca a no máximo ${limitMax.toLocaleString('pt-BR')} registros.`
      });
    }

    const documents = dedupeXmlItems(fullResult.documents || []);
    const fileName = buildExcelFileName(startDate, endDate);

    await registerAuditEvent({
      certificateId: cert.id,
      environment: filter.environment,
      nsu: null,
      fileName,
      action: 'excel',
      userEmail: userEmailFromReq(req),
      details: {
        count: documents.length,
        startDate: startDate || null,
        endDate: endDate || null
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: true
    });
    workbook.creator = 'Gestao NFS-e Nacional';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Notas NFS-e', {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
      properties: { defaultRowHeight: 18 }
    });

    worksheet.columns = [
      { key: 'nsu', width: 12 },
      { key: 'tipo', width: 10 },
      { key: 'chave', width: 48 },
      { key: 'numero', width: 14 },
      { key: 'status', width: 14 },
      { key: 'dataEmissao', width: 14 },
      { key: 'competencia', width: 14 },
      { key: 'cnpjPrestador', width: 20 },
      { key: 'nomePrestador', width: 32 },
      { key: 'cnpjTomador', width: 20 },
      { key: 'nomeTomador', width: 32 },
      { key: 'valor', width: 16 },
      { key: 'descricao', width: 40 },
      { key: 'municipio', width: 18 },
      { key: 'codigoTributacao', width: 16 }
    ];

    const headers = [
      'NSU', 'Tipo', 'Chave', 'Número NFS-e', 'Status', 'Data Emissão', 'Competência',
      'CNPJ Prestador', 'Nome Prestador', 'CNPJ Tomador', 'Nome Tomador',
      'Valor Serviço', 'Descrição', 'Município', 'Cód. Tributação'
    ];
    const headerRow = worksheet.addRow(headers);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF0D9488' } },
        bottom: { style: 'thin', color: { argb: 'FF0D9488' } },
        left: { style: 'thin', color: { argb: 'FF0D9488' } },
        right: { style: 'thin', color: { argb: 'FF0D9488' } }
      };
    });
    headerRow.commit();

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1 + documents.length, column: 15 }
    };

    let dataRow = 0;
    for (const doc of documents) {
      const metadata = doc.metadata || {};
      const status = metadata.status || doc.status || 'Autorizada';
      const isCancelled = Boolean(
        doc.is_cancelled ||
        metadata.isCancellation ||
        String(status).toLowerCase().includes('cancel')
      );
      const valorRaw = metadata.valorServico ?? doc.valor_servico ?? doc.valorServico;
      const valorNum = Number(String(valorRaw ?? '').replace(',', '.'));

      const row = worksheet.addRow({
        nsu: doc.nsu ?? '',
        tipo: doc.tipo || metadata.tipo || 'NFSE',
        chave: String(doc.chave || metadata.chave || '').trim(),
        numero: metadata.numeroNfse || doc.numero_nfse || doc.numeroNfse || '',
        status: isCancelled ? 'Cancelada' : status,
        dataEmissao: formatDateBr(
          metadata.dataEmissaoCompleta || doc.data_emissao || doc.dataEmissao || metadata.dataEmissao || ''
        ),
        competencia: formatDateBr(
          metadata.competencia || doc.competencia || ''
        ),
        cnpjPrestador: formatCnpj(metadata.prestadorCnpj || doc.prestador_cnpj),
        nomePrestador: metadata.prestadorNome || doc.prestador_nome || metadata.prestadorRazaoSocial || '',
        cnpjTomador: formatCnpj(metadata.tomadorCnpj || doc.tomador_cnpj),
        nomeTomador: metadata.tomadorNome || doc.tomador_nome || metadata.tomadorRazaoSocial || '',
        valor: Number.isFinite(valorNum) ? valorNum : 0,
        descricao: metadata.descricao || metadata.descricaoServico || '',
        municipio: metadata.municipioPrestacao || doc.municipio_prestacao || '',
        codigoTributacao: metadata.codigoTributacao || doc.codigo_tributacao || ''
      });

      dataRow += 1;
      styleDataRow(row, isCancelled, dataRow);
      row.commit();
    }

    await workbook.commit();
  } catch (err) {
    console.error('[download-excel]', safeErrorInfo(err));
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Não foi possível gerar o arquivo Excel.' });
    }
  }
});

module.exports = router;
