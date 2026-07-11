const express = require('express');
const ExcelJS = require('exceljs');
const { IS_VERCEL } = require('../config/constants');
const { listRemoteDocuments } = require('../services/supabase');
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

const router = express.Router();

router.get('/download-excel', async (req, res) => {
  try {
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

    const initialResult = await listRemoteDocuments({
      ...filter,
      limit: 10,
      offset: 0
    });

    const totalMatched = Number(initialResult.total || 0);
    if (totalMatched === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum documento encontrado.' });
    }

    const limitMax = IS_VERCEL ? MAX_EXCEL_DOCUMENTS_VERCEL : MAX_EXCEL_DOCUMENTS_LOCAL;
    if (totalMatched > limitMax) {
      return res.status(400).json({
        success: false,
        error: `O filtro atual encontrou ${totalMatched.toLocaleString('pt-BR')} documentos. Para baixar Excel, limite sua busca a no máximo ${limitMax.toLocaleString('pt-BR')} registros.`
      });
    }

    const fullResult = await listRemoteDocuments({
      ...filter,
      limit: totalMatched,
      offset: 0
    });

    const documents = dedupeXmlItems(fullResult.documents || []);
    const periodLabel = [startDate, endDate].filter(Boolean).join('_a_') || 'filtro';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="NFS-e_Relatorio_${periodLabel}.xlsx"`
    );

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: true
    });
    workbook.creator = 'Gestao NFS-e Nacional';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Notas NFS-e', {
      views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
      properties: { defaultRowHeight: 18 }
    });

    worksheet.mergeCells('A1:N1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Relatório NFS-e · ${documents.length} nota(s)${startDate || endDate ? ` · ${startDate || '…'} a ${endDate || '…'}` : ''}`;
    titleCell.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    worksheet.getRow(1).height = 30;
    worksheet.getRow(1).commit();

    worksheet.columns = [
      { key: 'nsu', width: 12 },
      { key: 'tipo', width: 10 },
      { key: 'chave', width: 48 },
      { key: 'numero', width: 14 },
      { key: 'status', width: 14 },
      { key: 'dataEmissao', width: 14 },
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
      'NSU', 'Tipo', 'Chave', 'Número NFS-e', 'Status', 'Data Emissão',
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
      from: { row: 2, column: 1 },
      to: { row: 2 + documents.length, column: 14 }
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
    console.error('Erro ao gerar Excel:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
});

module.exports = router;
