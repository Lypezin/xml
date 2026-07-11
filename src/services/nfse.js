const axios = require('axios');
const https = require('https');
const { onlyDigits } = require('../utils/cert');

function getNationalApiBaseUrl(environment) {
  return environment === 'producao'
    ? 'https://adn.nfse.gov.br/contribuintes'
    : 'https://adn.producaorestrita.nfse.gov.br/contribuintes';
}

function extractNationalApiErrors(responseData) {
  if (!responseData || !Array.isArray(responseData.Erros)) {
    return [];
  }

  return responseData.Erros
    .map(err => ({
      code: String(err.Codigo || err.codigo || '').trim(),
      description: String(err.Descricao || err.descricao || '').trim()
    }))
    .filter(err => err.code || err.description);
}

function formatNationalApiRejection(responseData) {
  const errors = extractNationalApiErrors(responseData);
  if (errors.length === 0) {
    return null;
  }

  const rawMessage = errors
    .map(err => `${err.code}: ${err.description}`.trim())
    .join(' | ');

  if (errors.some(err => err.code === 'E2214' || /cadeia de certifica/i.test(err.description))) {
    return `Rejeicao da API Nacional: ${rawMessage}. O certificado de transmissao foi recusado por cadeia de certificacao. Reexporte ou reemita o A1 com a cadeia completa ICP-Brasil e envie novamente.`;
  }

  return `Rejeicao da API Nacional: ${rawMessage}`;
}

function getNationalApiStatus(responseData) {
  return String(
    responseData?.StatusProcessamento ||
    responseData?.statusProcessamento ||
    responseData?.status ||
    ''
  ).trim();
}

function extractDfeDocuments(responseData) {
  if (!responseData) return [];

  if (Array.isArray(responseData.LoteDFe)) return responseData.LoteDFe;
  if (Array.isArray(responseData.loteDFe)) return responseData.loteDFe;
  if (Array.isArray(responseData)) return responseData;

  const keys = Object.keys(responseData);
  for (const key of keys) {
    const value = responseData[key];
    if (Array.isArray(value) && value.length > 0 && (value[0].ArquivoXml || value[0].arquivoXml)) {
      return value;
    }
  }

  if (responseData.ArquivoXml || responseData.conteudo || responseData.docZip) {
    return [responseData];
  }

  return [];
}

function getResponseNsu(responseData, variants) {
  for (const key of variants) {
    if (responseData && responseData[key] !== undefined && responseData[key] !== null) {
      return Number(responseData[key]);
    }
  }
  return null;
}

function resolveCnpjConsulta(cnpjConsulta, certificateCnpj) {
  const requested = onlyDigits(cnpjConsulta);
  if (requested.length === 14) return requested;

  const certificate = onlyDigits(certificateCnpj);
  return certificate.length === 14 ? certificate : '';
}

function buildDfeUrl(baseUrl, nsu, cnpjConsulta) {
  const params = new URLSearchParams();
  if (cnpjConsulta) {
    params.set('cnpjConsulta', cnpjConsulta);
  }
  params.set('lote', 'true');

  return `${baseUrl}/DFe/${Number(nsu || 0)}?${params.toString()}`;
}

function buildEventosUrl(baseUrl, chaveAcesso) {
  const chave = String(chaveAcesso || '').trim();
  if (!chave || chave === 'N/A') return null;
  return `${baseUrl}/NFSe/${encodeURIComponent(chave)}/Eventos`;
}

function getCancelCheckMode() {
  const mode = String(process.env.CANCEL_CHECK_MODE || 'lote+eventos').trim().toLowerCase();
  if (mode === 'off' || mode === 'lote' || mode === 'lote+eventos') return mode;
  return 'lote+eventos';
}

function isNationalApiFiscalStatus(status) {
  return (status >= 200 && status < 300) || status === 400 || status === 404;
}

function buildNationalApiContext(response, url, environment, cnpjConsulta) {
  const data = response?.data;
  return {
    httpStatus: response?.status || null,
    statusProcessamento: getNationalApiStatus(data) || null,
    endpoint: url,
    environment,
    cnpjConsulta: cnpjConsulta || null,
    errors: extractNationalApiErrors(data),
    rawKeys: data && typeof data === 'object' ? Object.keys(data) : []
  };
}

function normalizeEnvironment(environment) {
  return environment === 'homologacao' ? 'homologacao' : 'producao';
}

module.exports = {
  getNationalApiBaseUrl,
  extractNationalApiErrors,
  formatNationalApiRejection,
  getNationalApiStatus,
  extractDfeDocuments,
  getResponseNsu,
  resolveCnpjConsulta,
  buildDfeUrl,
  buildEventosUrl,
  getCancelCheckMode,
  isNationalApiFiscalStatus,
  buildNationalApiContext,
  normalizeEnvironment
};
