const express = require('express');
const AdmZip = require('adm-zip');
const axios = require('axios');
const fs = require('fs');
const https = require('https');
const path = require('path');
const xmlCache = require('../utils/xmlCache');
const { DOWNLOADS_DIR, IS_VERCEL } = require('../config/constants');
const {
  supabaseRpc,
  getSupabaseXmlPayload,
  listSupabaseXmlPayloads,
  listRemoteDocuments,
  listRemoteCertificates,
  getStorageSummary
} = require('../services/supabase');
const { resolveCertificateForRequest } = require('../services/localCertificates');
const { getCertificateBuffer, onlyDigits } = require('../utils/cert');

const router = express.Router();

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

    const zip = new AdmZip();
    for (const cached of dedupeXmlItems(payloads)) {
      zip.addFile(cached.fileName, Buffer.from(cached.xmlString, 'utf8'));
    }

    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=NFS-e_XMLs_Baixados.zip');
    return res.send(zipBuffer);
  } catch (e) {
    console.error('Erro ao gerar arquivo ZIP:', e);
    return res.status(500).json({ error: 'Erro ao gerar arquivo ZIP: ' + e.message });
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
      includeCancelled: String(includeCancelled).toLowerCase() === 'true'
    });
    const documents = dedupeXmlItems(result.documents || []);

    if (!documents || documents.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum documento no período.' });
    }

    const zip = new AdmZip();
    let addedCount = 0;

    for (const doc of documents) {
      const fileName = doc.file_name || doc.arquivo;
      if (!fileName) continue;

      const localPath = path.join(DOWNLOADS_DIR, fileName);
      if (!IS_VERCEL && fs.existsSync(localPath)) {
        zip.addLocalFile(localPath);
        addedCount++;
      } else {
        const token = doc.metadata?.token || doc.token;
        if (token) {
          const payload = await getSupabaseXmlPayload(token);
          if (payload && payload.xml_content) {
            zip.addFile(fileName, Buffer.from(payload.xml_content, 'utf8'));
            addedCount++;
          }
        }
      }
    }

    if (addedCount === 0) {
      return res.status(400).json({ success: false, error: 'Sem conteúdo XML local/remoto disponível.' });
    }

    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=NFS-e_Periodo_XMLs.zip');
    return res.send(zipBuffer);
  } catch (err) {
    console.error('Erro ao gerar ZIP:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
