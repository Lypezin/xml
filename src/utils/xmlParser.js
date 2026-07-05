const crypto = require('crypto');

function extractTag(xmlString, tagName) {
  const match = xmlString.match(new RegExp(`<([a-zA-Z0-9]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/\\1?${tagName}>`, 'i'));
  return match ? match[2].trim() : null;
}

function extractSection(xmlString, tagName) {
  const match = xmlString.match(new RegExp(`<([a-zA-Z0-9]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/\\1?${tagName}>`, 'i'));
  return match ? match[2] : null;
}

function normalizeDate(value) {
  if (!value) return 'N/A';
  return String(value).split('T')[0];
}

function buildXmlToken() {
  return crypto.randomBytes(16).toString('hex');
}

function buildStableXmlToken({ certificateId, environment, nsu, xmlSha256, chave }) {
  return crypto
    .createHash('sha256')
    .update([
      certificateId || '',
      environment || '',
      nsu === undefined || nsu === null ? '' : String(nsu),
      xmlSha256 || '',
      chave || ''
    ].join('|'))
    .digest('hex');
}

function parseXmlMetadata(xmlString, nsu) {
  const metadata = {
    nsu: nsu || 'N/A',
    chave: 'N/A',
    numeroNfse: 'N/A',
    numeroDfse: 'N/A',
    numeroDps: 'N/A',
    serieDps: 'N/A',
    prestadorCnpj: 'N/A',
    prestadorNome: 'N/A',
    tomadorCnpj: 'N/A',
    tomadorNome: 'N/A',
    valorServico: '0.00',
    dataEmissao: 'N/A',
    dataProcessamento: 'N/A',
    competencia: 'N/A',
    municipioEmissao: 'N/A',
    municipioPrestacao: 'N/A',
    municipioIncidencia: 'N/A',
    codigoTributacao: 'N/A',
    tributacaoNacional: 'N/A',
    descricaoServico: 'N/A',
    status: 'Autorizada',
    eventoDescricao: 'N/A',
    eventoMotivo: 'N/A'
  };

  try {
    const chMatch = xmlString.match(/<chNFSe>([^<]+)<\/chNFSe>/i) || xmlString.match(/<chave[^>]*>([^<]+)<\/chave>/i);
    if (chMatch) metadata.chave = chMatch[1];

    metadata.numeroNfse = extractTag(xmlString, 'nNFSe') || metadata.numeroNfse;
    metadata.numeroDfse = extractTag(xmlString, 'nDFSe') || metadata.numeroDfse;
    metadata.numeroDps = extractTag(xmlString, 'nDPS') || metadata.numeroDps;
    metadata.serieDps = extractTag(xmlString, 'serie') || metadata.serieDps;
    metadata.dataProcessamento = normalizeDate(extractTag(xmlString, 'dhProc'));
    metadata.competencia = normalizeDate(extractTag(xmlString, 'dCompet'));
    metadata.municipioEmissao = extractTag(xmlString, 'xLocEmi') || metadata.municipioEmissao;
    metadata.municipioPrestacao = extractTag(xmlString, 'xLocPrestacao') || metadata.municipioPrestacao;
    metadata.municipioIncidencia = extractTag(xmlString, 'xLocIncid') || metadata.municipioIncidencia;
    metadata.codigoTributacao = extractTag(xmlString, 'cTribNac') || metadata.codigoTributacao;
    metadata.tributacaoNacional = extractTag(xmlString, 'xTribNac') || metadata.tributacaoNacional;

    const emitSectionMatch = xmlString.match(/<emit>([\s\S]*?)<\/emit>/i) || 
                             xmlString.match(/<prestador>([\s\S]*?)<\/prestador>/i) ||
                             xmlString.match(/<prest>([\s\S]*?)<\/prest>/i);
    if (emitSectionMatch) {
      const emitSection = emitSectionMatch[1];
      const cnpj = emitSection.match(/<CNPJ>([^<]+)<\/CNPJ>/i) || emitSection.match(/<CPF>([^<]+)<\/CPF>/i);
      const nome = emitSection.match(/<xNome>([^<]+)<\/xNome>/i) || emitSection.match(/<xFant>([^<]+)<\/xFant>/i);
      if (cnpj) metadata.prestadorCnpj = cnpj[1];
      if (nome) metadata.prestadorNome = nome[1];
    }

    const tomSectionMatch = xmlString.match(/<toma>([\s\S]*?)<\/toma>/i) || 
                            xmlString.match(/<tomador>([\s\S]*?)<\/tomador>/i) ||
                            xmlString.match(/<tom>([\s\S]*?)<\/tom>/i);
    if (tomSectionMatch) {
      const tomSection = tomSectionMatch[1];
      const cnpj = tomSection.match(/<CNPJ>([^<]+)<\/CNPJ>/i) || tomSection.match(/<CPF>([^<]+)<\/CPF>/i);
      const nome = tomSection.match(/<xNome>([^<]+)<\/xNome>/i);
      if (cnpj) metadata.tomadorCnpj = cnpj[1];
      if (nome) metadata.tomadorNome = nome[1];
    }

    const valMatch = xmlString.match(/<vServ>([^<]+)<\/vServ>/i) || 
                     xmlString.match(/<vServPrest>([^<]+)<\/vServPrest>/i) ||
                     xmlString.match(/<valorServico>([^<]+)<\/valorServico>/i) ||
                     xmlString.match(/<vLiq>([^<]+)<\/vLiq>/i);
    if (valMatch) metadata.valorServico = valMatch[1];

    const dataMatch = xmlString.match(/<(?:[a-zA-Z0-9]+:)?dhEmit>([^<]+)<\/(?:[a-zA-Z0-9]+:)?dhEmit>/i) || 
                      xmlString.match(/<(?:[a-zA-Z0-9]+:)?dhEmi>([^<]+)<\/(?:[a-zA-Z0-9]+:)?dhEmi>/i) ||
                      xmlString.match(/<(?:[a-zA-Z0-9]+:)?dhProc>([^<]+)<\/(?:[a-zA-Z0-9]+:)?dhProc>/i) ||
                      xmlString.match(/<(?:[a-zA-Z0-9]+:)?dEmi>([^<]+)<\/(?:[a-zA-Z0-9]+:)?dEmi>/i) ||
                      xmlString.match(/<(?:[a-zA-Z0-9]+:)?DataEmissao>([^<]+)<\/(?:[a-zA-Z0-9]+:)?DataEmissao>/i) ||
                      xmlString.match(/<(?:[a-zA-Z0-9]+:)?dataEmissao>([^<]+)<\/(?:[a-zA-Z0-9]+:)?dataEmissao>/i);
    if (dataMatch) {
      metadata.dataEmissao = dataMatch[1].split('T')[0];
      metadata.dataEmissaoCompleta = dataMatch[1];
    }

    const descMatch = xmlString.match(/<xDescServ>([^<]+)<\/xDescServ>/i) ||
                      xmlString.match(/<descServico>([^<]+)<\/descServico>/i);
    if (descMatch) metadata.descricaoServico = descMatch[1];

    const eventSection = extractSection(xmlString, 'pedRegEvento') || extractSection(xmlString, 'infEvento');
    if (eventSection) {
      metadata.status = 'Evento';
      metadata.eventoDescricao = extractTag(eventSection, 'xDesc') || metadata.eventoDescricao;
      metadata.eventoMotivo = extractTag(eventSection, 'xMotivo') || metadata.eventoMotivo;
      const rawDate = extractTag(eventSection, 'dhEvento') || extractTag(xmlString, 'dhProc');
      metadata.dataEmissao = normalizeDate(rawDate);
      metadata.dataEmissaoCompleta = rawDate;
      metadata.descricaoServico = metadata.eventoDescricao !== 'N/A' ? metadata.eventoDescricao : metadata.descricaoServico;
    }

  } catch (e) {
    console.error('Erro ao fazer parse dos metadados do XML:', e);
  }

  return metadata;
}

module.exports = {
  extractTag,
  extractSection,
  normalizeDate,
  buildXmlToken,
  buildStableXmlToken,
  parseXmlMetadata
};
