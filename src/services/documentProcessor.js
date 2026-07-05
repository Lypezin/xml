const zlib = require('zlib');
const crypto = require('crypto');
const { parseXmlMetadata, buildStableXmlToken } = require('../utils/xmlParser');
const { storeSupabaseXmlPayload } = require('./supabase');

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

async function processBatchDocuments({ documentsList, selectedCertificate, requestEnvironment, requestCnpjConsulta, xmlCache, receivedOnly = true }) {
  const processedDocs = [];
  const receiverCnpj = onlyDigits(requestCnpjConsulta || selectedCertificate?.cnpj);

  for (const doc of documentsList) {
    const base64GzipData = doc.ArquivoXml || doc.arquivoXml || doc.conteudo || doc.docZip || doc.xml || doc.dps || doc.documento;
    const docNsu = doc.NSU !== undefined ? doc.NSU : (doc.nsu !== undefined ? doc.nsu : null);
    const docChave = doc.ChaveAcesso || doc.chaveAcesso || null;
    const docTipo = doc.TipoDocumento || doc.tipoDocumento || 'NFSE';

    if (!base64GzipData) {
      console.warn('Documento sem conteúdo compactado:', JSON.stringify(doc).substring(0, 200));
      continue;
    }

    try {
      // 1. Decodificar Base64
      const gzipBuffer = Buffer.from(base64GzipData, 'base64');
      
      // 2. Descompactar Gzip
      let xmlString;
      try {
        xmlString = zlib.gunzipSync(gzipBuffer).toString('utf8');
      } catch (gzipErr) {
        // Se falhar, talvez esteja em formato texto puro XML codificado em Base64
        xmlString = gzipBuffer.toString('utf8');
      }

      // 3. Extrair metadados
      const meta = parseXmlMetadata(xmlString, docNsu);
      const tomadorCnpj = onlyDigits(meta.tomadorCnpj);

      if (receivedOnly && receiverCnpj && tomadorCnpj !== receiverCnpj) {
        console.log(`[SKIP] NSU ${docNsu} ignorado: documento nao recebido pelo CNPJ ${receiverCnpj}. Tomador extraido: ${tomadorCnpj || 'N/A'}.`);
        continue;
      }

      // 4. Usar a chave de acesso que a API já retorna
      const chaveAcesso = docChave || meta.chave;
      const safeChave = chaveAcesso !== 'N/A' ? chaveAcesso : `NSU_${docNsu}`;
      const fileName = `${docTipo}_NSU_${docNsu}_${safeChave}.xml`;
      const xmlSha256 = crypto.createHash('sha256').update(xmlString, 'utf8').digest('hex');
      const token = buildStableXmlToken({
        certificateId: selectedCertificate.id,
        environment: requestEnvironment,
        nsu: docNsu,
        xmlSha256,
        chave: chaveAcesso
      });
      
      xmlCache.set(token, {
        fileName,
        xmlString,
        createdAt: Date.now(),
        certificateId: selectedCertificate.id,
        environment: requestEnvironment,
        nsu: docNsu,
        chave: chaveAcesso,
        tipo: docTipo
      });

      await storeSupabaseXmlPayload({
        token,
        certificateId: selectedCertificate.id,
        environment: requestEnvironment,
        nsu: docNsu,
        fileName,
        xmlString
      });

      const { IS_VERCEL, DOWNLOADS_DIR } = require('../config/constants');
      if (!IS_VERCEL) {
        const fs = require('fs');
        const path = require('path');
        if (!fs.existsSync(DOWNLOADS_DIR)) {
          fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
        }
        fs.writeFileSync(path.join(DOWNLOADS_DIR, fileName), xmlString, 'utf8');
      }

      console.log(`[OK] NSU ${docNsu} | ${docTipo} | Chave: ${chaveAcesso} | XML pronto para download.`);

      processedDocs.push({
        nsu: docNsu,
        tipo: docTipo,
        chave: chaveAcesso,
        numeroNfse: meta.numeroNfse,
        numeroDfse: meta.numeroDfse,
        numeroDps: meta.numeroDps,
        serieDps: meta.serieDps,
        prestadorCnpj: meta.prestadorCnpj,
        prestadorNome: meta.prestadorNome,
        tomadorCnpj: meta.tomadorCnpj,
        tomadorNome: meta.tomadorNome,
        descricao: meta.descricaoServico,
        valorServico: meta.valorServico,
        dataEmissao: meta.dataEmissao,
        dataEmissaoCompleta: meta.dataEmissaoCompleta || meta.dataEmissao,
        dataProcessamento: meta.dataProcessamento,
        competencia: meta.competencia,
        municipioEmissao: meta.municipioEmissao,
        municipioPrestacao: meta.municipioPrestacao,
        municipioIncidencia: meta.municipioIncidencia,
        codigoTributacao: meta.codigoTributacao,
        tributacaoNacional: meta.tributacaoNacional,
        status: meta.status,
        eventoDescricao: meta.eventoDescricao,
        eventoMotivo: meta.eventoMotivo,
        arquivo: fileName,
        xmlSha256: xmlSha256,
        token: token
      });
    } catch (parseErr) {
      console.error(`Erro ao decodificar/descompactar NSU ${docNsu}:`, parseErr);
    }
  }

  return processedDocs;
}

module.exports = {
  processBatchDocuments
};
