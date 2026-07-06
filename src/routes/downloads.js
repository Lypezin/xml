const express = require('express');
const archiver = require('archiver');
const ExcelJS = require('exceljs');
const axios = require('axios');
const fs = require('fs');
const https = require('https');
const path = require('path');
const xmlCache = require('../utils/xmlCache');
const { DOWNLOADS_DIR, IS_VERCEL } = require('../config/constants');
const {
  supabaseRpc,
  getSupabaseXmlPayload,
  getSupabaseXmlPayloads,
  listSupabaseXmlPayloads,
  listRemoteDocuments,
  listRemoteCertificates,
  getStorageSummary
} = require('../services/supabase');
const { resolveCertificateForRequest } = require('../services/localCertificates');
const { getCertificateBuffer, onlyDigits } = require('../utils/cert');

const router = express.Router();
const MAX_ZIP_DOCUMENTS = 300;
const MAX_EXCEL_DOCUMENTS = 1000;

function clampListLimit(limit) {
  const parsed = Number(limit || 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(parsed, 10);
}

function clampListOffset(offset) {
  const parsed = Number(offset || 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function getUniqueXmlKey(item) {
  const metadata = item.metadata || {};
  const chave = String(item.chave || metadata.chave || '').trim();
  if (chave && chave !== 'N/A' && !chave.startsWith('NSU_')) {
    return `CHAVE:${chave}`;
  }
  return `FILE:${item.token || metadata.token || item.fileName || item.file_name || item.arquivo || item.nsu || 'SEM_CHAVE'}`;
}

function dedupeXmlItems(items) {
  const byKey = new Map();
  const sorted = [...(items || [])].sort((a, b) => {
    const aEvento = String(a.tipo || a.metadata?.tipo || '').toUpperCase() === 'EVENTO';
    const bEvento = String(b.tipo || b.metadata?.tipo || '').toUpperCase() === 'EVENTO';
    return Number(aEvento) - Number(bEvento);
  });
  for (const item of sorted) {
    const key = getUniqueXmlKey(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

function formatCnpj(cnpj) {
  const clean = String(cnpj || '').replace(/\D/g, '');
  if (clean.length !== 14) return cnpj || '';
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatDateBr(dateStr) {
  if (!dateStr || dateStr === 'N/A') return '';
  const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    return `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;
  }
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    const d = String(parsed.getDate()).padStart(2, '0');
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const y = parsed.getFullYear();
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}


function getDanfseBaseUrl(environment) {
  return environment === 'homologacao'
    ? 'https://adn.producaorestrita.nfse.gov.br/danfse'
    : 'https://adn.nfse.gov.br/danfse';
}

function getDanfseFileName(chave) {
  const safeKey = onlyDigits(chave) || 'nfse';
  return `DANFSe_${safeKey}.pdf`;
}

function summarizeRemoteError(data) {
  if (!data) return '';
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function getDocumentToken(doc) {
  return doc?.metadata?.token || doc?.token || '';
}

async function resolveCertificateMetadataForList(certificateId) {
  const certificates = await listRemoteCertificates();
  if (Array.isArray(certificates) && certificates.length > 0) {
    const cert = certificateId
      ? certificates.find(item => item.id === certificateId)
      : (certificates.find(item => item.active) || certificates[0]);
    if (cert) return cert;
  }
  return resolveCertificateForRequest(certificateId);
}

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
      return res.status(400).json({ success: false, error: 'Chave de acesso NFS-e invalida. A chave nacional deve ter 50 digitos.' });
    }

    const cert = await resolveCertificateForRequest(req.query.certificateId);
    const pfx = getCertificateBuffer(cert);
    if (!cert || !pfx || !cert.passphrase) {
      return res.status(400).json({ success: false, error: 'Certificado nao configurado para consultar o DANFSe.' });
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
    if (response.status >= 400 || payload.length === 0 || (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream'))) {
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
      limit,
      offset
    } = req.query;
    const cert = await resolveCertificateMetadataForList(certificateId);
    if (!cert) {
      return res.status(400).json({ success: false, error: 'Certificado não configurado.' });
    }

    const receiverCnpj = onlyDigits(partyCnpj) || onlyDigits(cnpj) || onlyDigits(cert.cnpj);

    const result = await listRemoteDocuments({
      certificateId: cert.id,
      environment,
      startDate: startDate || null,
      endDate: endDate || null,
      cnpj: '',
      partyCnpj: receiverCnpj,
      partyRole: 'tomador',
      search,
      includeCancelled: String(includeCancelled).toLowerCase() === 'true',
      limit: clampListLimit(limit),
      offset: clampListOffset(offset)
    });

    return res.json({
      success: true,
      documents: result.documents,
      total: result.total,
      summary: {
        totalValue: result.totalValue || 0
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

router.get('/download-excel', async (req, res) => {
  try {
    const {
      certificateId,
      environment = 'producao',
      startDate,
      endDate,
      cnpj,
      partyCnpj,
      search = '',
      includeCancelled = 'false'
    } = req.query;
    
    const cert = await resolveCertificateMetadataForList(certificateId);
    if (!cert) {
      return res.status(400).json({ success: false, error: 'Certificado não encontrado.' });
    }

    const receiverCnpj = onlyDigits(partyCnpj) || onlyDigits(cnpj) || onlyDigits(cert.cnpj);

    const initialResult = await listRemoteDocuments({
      certificateId: cert.id,
      environment,
      startDate: startDate || null,
      endDate: endDate || null,
      cnpj: '',
      partyCnpj: receiverCnpj,
      partyRole: 'tomador',
      search,
      includeCancelled: String(includeCancelled).toLowerCase() === 'true',
      limit: 10,
      offset: 0
    });

    const totalMatched = Number(initialResult.total || 0);
    if (totalMatched === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum documento encontrado.' });
    }

    if (IS_VERCEL && totalMatched > MAX_EXCEL_DOCUMENTS) {
      return res.status(400).json({
        success: false,
        error: `O filtro atual encontrou ${totalMatched.toLocaleString('pt-BR')} documentos. Para baixar Excel via rede, limite sua busca a no máximo ${MAX_EXCEL_DOCUMENTS.toLocaleString('pt-BR')} registros.`
      });
    }

    const fullResult = await listRemoteDocuments({
      certificateId: cert.id,
      environment,
      startDate: startDate || null,
      endDate: endDate || null,
      cnpj: '',
      partyCnpj: receiverCnpj,
      partyRole: 'tomador',
      search,
      includeCancelled: String(includeCancelled).toLowerCase() === 'true',
      limit: totalMatched,
      offset: 0
    });
    
    const documents = dedupeXmlItems(fullResult.documents || []);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=NFS-e_Relatorio.xlsx');

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
    const worksheet = workbook.addWorksheet('Notas NFS-e');

    worksheet.columns = [
      { header: 'NSU', key: 'nsu', width: 12 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Chave', key: 'chave', width: 50 },
      { header: 'Número NFS-e', key: 'numero', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Data Emissão', key: 'dataEmissao', width: 15 },
      { header: 'CNPJ Prestador', key: 'cnpjPrestador', width: 22 },
      { header: 'Nome Prestador', key: 'nomePrestador', width: 35 },
      { header: 'CNPJ Tomador', key: 'cnpjTomador', width: 22 },
      { header: 'Nome Tomador', key: 'nomeTomador', width: 35 },
      { header: 'Valor Serviço', key: 'valor', width: 18, style: { numFormat: '"R$ " #,##0.00' } },
      { header: 'Descrição', key: 'descricao', width: 50 },
      { header: 'Município', key: 'municipio', width: 20 },
      { header: 'Código Tributação', key: 'codigoTributacao', width: 20 }
    ];

    // Estilizar a linha de cabeçalho
    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 11 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F4E78' } // Azul corporativo escuro
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    headerRow.commit();

    let rowIdx = 2;
    for (const doc of documents) {
      const metadata = doc.metadata || {};
      const row = worksheet.addRow({
        nsu: doc.nsu || '',
        tipo: doc.tipo || metadata.tipo || '',
        chave: String(doc.chave || metadata.chave || '').trim(),
        numero: metadata.numeroNfse || doc.numeroNfse || '',
        status: metadata.status || '',
        dataEmissao: formatDateBr(metadata.dataEmissaoCompleta || doc.dataEmissao || metadata.dataEmissao || ''),
        cnpjPrestador: formatCnpj(metadata.prestadorCnpj),
        nomePrestador: metadata.prestadorNome || metadata.prestadorRazaoSocial || '',
        cnpjTomador: formatCnpj(metadata.tomadorCnpj),
        nomeTomador: metadata.tomadorNome || metadata.tomadorRazaoSocial || '',
        valor: metadata.valorServico ? Number(metadata.valorServico) : 0,
        descricao: metadata.descricao || '',
        municipio: metadata.municipioPrestacao || '',
        codigoTributacao: metadata.codigoTributacao || ''
      });

      row.height = 20;

      // Alinhamento específico por tipo de coluna
      row.getCell('nsu').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('tipo').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('numero').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('status').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('dataEmissao').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('cnpjPrestador').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('cnpjTomador').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('valor').alignment = { horizontal: 'right', vertical: 'middle' };
      row.getCell('codigoTributacao').alignment = { horizontal: 'center', vertical: 'middle' };

      // Estilo de fonte e bordas inferiores de grade para todas as células
      row.eachCell((cell) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
      });

      // Zebra striping
      if (rowIdx % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF9FAFB' } // Cinza/azul claro e moderno
          };
        });
      }

      row.commit();
      rowIdx++;
    }

    await workbook.commit();
  } catch (err) {
    console.error('Erro ao gerar Excel:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
});

router.post('/download-period-zip', async (req, res) => {
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
      includeCancelled = 'false'
    } = req.body;
    const cert = await resolveCertificateMetadataForList(certificateId);
    if (!cert) {
      return res.status(400).json({ success: false, error: 'Certificado não encontrado.' });
    }

    const receiverCnpj = onlyDigits(partyCnpj) || onlyDigits(cnpj) || onlyDigits(cert.cnpj);

    const result = await listRemoteDocuments({
      certificateId: cert.id,
      environment,
      startDate: startDate || null,
      endDate: endDate || null,
      cnpj: '',
      partyCnpj: receiverCnpj,
      partyRole: 'tomador',
      search,
      includeCancelled: String(includeCancelled).toLowerCase() === 'true',
      limit: 10,
      offset: 0
    });
    let documents = dedupeXmlItems(result.documents || []);

    if (!documents || documents.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum documento no período.' });
    }

    const totalMatched = Number(result.total || documents.length);
    if (IS_VERCEL && totalMatched > MAX_ZIP_DOCUMENTS) {
      return res.status(400).json({
        success: false,
        error: `O filtro atual encontrou ${totalMatched.toLocaleString('pt-BR')} XMLs. Para evitar travamentos de payload na Vercel, baixe no máximo ${MAX_ZIP_DOCUMENTS.toLocaleString('pt-BR')} por ZIP usando os filtros de período ou unidade.`
      });
    }

    if (totalMatched > documents.length) {
      const fullResult = await listRemoteDocuments({
        certificateId: cert.id,
        environment,
        startDate: startDate || null,
        endDate: endDate || null,
        cnpj: '',
        partyCnpj: receiverCnpj,
        partyRole: 'tomador',
        search,
        includeCancelled: String(includeCancelled).toLowerCase() === 'true',
        limit: totalMatched,
        offset: 0
      });
      documents = dedupeXmlItems(fullResult.documents || []);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=NFS-e_Periodo_XMLs.zip');
    
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => {
      console.error('Archive stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro no stream do ZIP: ' + err.message });
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
        const fileName = doc.file_name || doc.arquivo;
        const localPath = path.join(DOWNLOADS_DIR, fileName);
        
        if (!IS_VERCEL && fs.existsSync(localPath)) {
          archive.file(localPath, { name: fileName });
        } else {
          const payload = payloadByToken.get(getDocumentToken(doc));
          if (payload && payload.xml_content) {
            archive.append(Buffer.from(payload.xml_content, 'utf8'), { name: fileName });
          }
        }
      }
      
      remotePayloads.length = 0; 
      payloadByToken.clear();
    }

    await archive.finalize();
  } catch (err) {
    console.error('Erro ao gerar ZIP:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
});

module.exports = router;
