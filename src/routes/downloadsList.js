const express = require('express');
const xmlCache = require('../utils/xmlCache');
const {
  listRemoteDocuments,
  getRemoteDocumentTotals,
  getStorageSummary
} = require('../services/supabase');
const {
  clampListLimit,
  clampListOffset,
  resolveCertificateMetadataForList,
  buildListFilterParams
} = require('../utils/downloadHelpers');

const router = express.Router();

router.post('/clear-downloads', async (req, res) => {
  const count = xmlCache.size;
  xmlCache.clear();
  return res.json({
    success: true,
    count,
    preservedRemotePayloads: true
  });
});

router.get('/list-documents', async (req, res) => {
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
      cancelledMode = '',
      limit,
      offset,
      skipTotals = 'false'
    } = req.query;
    const cert = await resolveCertificateMetadataForList(certificateId);
    if (!cert) {
      return res.status(400).json({ success: false, error: 'Certificado não configurado.' });
    }

    const wantSkipTotals = String(skipTotals).toLowerCase() === 'true' || skipTotals === '1';
    const filter = buildListFilterParams({
      environment, startDate, endDate, cnpj, partyCnpj, partyRole, search,
      includeCancelled, onlyCancelled, cancelledMode
    }, cert);

    const result = await listRemoteDocuments({
      ...filter,
      limit: clampListLimit(limit),
      offset: clampListOffset(offset),
      skipTotals: wantSkipTotals
    });

    return res.json({
      success: true,
      documents: result.documents,
      total: result.total,
      totalsPending: Boolean(result.totalsPending),
      summary: {
        totalValue: result.totalValue == null ? null : (result.totalValue || 0)
      }
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('Erro ao listar documentos:', detail);
    return res.status(500).json({
      success: false,
      error: typeof detail === 'string' ? detail : JSON.stringify(detail)
    });
  }
});

router.get('/document-totals', async (req, res) => {
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
      return res.status(400).json({ success: false, error: 'Certificado não configurado.' });
    }

    const filter = buildListFilterParams({
      environment, startDate, endDate, cnpj, partyCnpj, partyRole, search,
      includeCancelled, onlyCancelled, cancelledMode
    }, cert);

    const result = await getRemoteDocumentTotals(filter);

    return res.json({
      success: true,
      total: result.total,
      totalValue: result.totalValue,
      source: result.source,
      summary: { totalValue: result.totalValue }
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('Erro ao obter totais:', detail);
    return res.status(500).json({
      success: false,
      error: typeof detail === 'string' ? detail : JSON.stringify(detail)
    });
  }
});

router.get('/storage-summary', async (req, res) => {
  try {
    const { certificateId, environment = '' } = req.query;
    const summary = await getStorageSummary({
      certificateId: certificateId || '',
      environment: environment || ''
    });
    return res.json({ success: true, summary: summary || {} });
  } catch (err) {
    console.error('Erro ao carregar resumo de armazenamento:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
