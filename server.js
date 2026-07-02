const express = require('express');
const multer = require('multer');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const forge = require('node-forge');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_VERCEL = process.env.VERCEL === '1';

// Configurações de pastas
const CONFIG_DIR = path.join(__dirname, 'config');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
const CERT_FILE = path.join(CONFIG_DIR, 'certificate.pfx');
const CERTS_DIR = path.join(CONFIG_DIR, 'certificates');
const CERTS_INDEX_FILE = path.join(CONFIG_DIR, 'certificates.json');
const SUPABASE_CONFIG_FILE = path.join(CONFIG_DIR, 'supabase.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const xmlCache = new Map();

// Garantir que as pastas existem
if (!IS_VERCEL && !fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}
if (!IS_VERCEL && !fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}
if (!IS_VERCEL && !fs.existsSync(CERTS_DIR)) {
  fs.mkdirSync(CERTS_DIR, { recursive: true });
}

// Middleware
app.use(express.json());
app.get('/api/auth-config', (req, res) => {
  const config = getSupabaseConfig();
  return res.json({
    authRequired: isSupabaseAuthRequired(),
    supabaseUrl: config ? config.url : null,
    publishableKey: config ? config.key : null
  });
});

app.use((req, res, next) => {
  if (!isAccessAuthEnabled()) {
    return next();
  }

  const header = req.headers.authorization || '';
  const [type, encoded] = header.split(' ');
  if (type === 'Basic' && encoded) {
    const [user, password] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (user === process.env.APP_ACCESS_USER && password === process.env.APP_ACCESS_PASSWORD) {
      return next();
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm=\"XML NFS-e\"');
  return res.status(401).send('Autenticação obrigatória.');
});
app.use('/api', requireSupabaseAuth);
app.use(express.static(path.join(__dirname, 'public')));
if (!IS_VERCEL) {
  app.use('/downloads', express.static(DOWNLOADS_DIR));
}

// Configuração do multer em memória para receber o arquivo do certificado
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

function isAccessAuthEnabled() {
  return Boolean(process.env.APP_ACCESS_USER && process.env.APP_ACCESS_PASSWORD);
}

// Função auxiliar para carregar as configurações locais
function getSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch (e) {
      console.error('Erro ao ler settings.json:', e);
    }
  }
  return null;
}

// Função auxiliar para salvar configurações
function saveSettings(settings) {
  if (IS_VERCEL) return;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

function getSupabaseConfig() {
  const envUrl = process.env.SUPABASE_URL;
  const envKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const envSecret = process.env.SUPABASE_APP_SECRET;

  if (envUrl && envKey && envSecret) {
    return {
      url: String(envUrl).replace(/\/+$/, ''),
      key: envKey,
      appSecret: envSecret
    };
  }

  if (!fs.existsSync(SUPABASE_CONFIG_FILE)) {
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(SUPABASE_CONFIG_FILE, 'utf8').replace(/^\uFEFF/, ''));
    const key = config.publishableKey || config.anonKey;
    if (!config.enabled || !config.url || !key || !config.appSecret) {
      return null;
    }

    return {
      url: String(config.url).replace(/\/+$/, ''),
      key,
      appSecret: config.appSecret
    };
  } catch (e) {
    console.error('Erro ao ler supabase.json:', e.message);
    return null;
  }
}

function isSupabaseAuthRequired() {
  return process.env.AUTH_REQUIRED === 'true' || IS_VERCEL;
}

function getAllowedEmails() {
  return String(process.env.AUTH_ALLOWED_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function getAllowedDomains() {
  return String(process.env.AUTH_ALLOWED_DOMAINS || process.env.AUTH_ALLOWED_DOMAIN || '')
    .split(',')
    .map(domain => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

function isUserAllowed(email) {
  const normalizedEmail = String(email || '').toLowerCase();
  if (!normalizedEmail) return false;

  const allowedEmails = getAllowedEmails();
  const allowedDomains = getAllowedDomains();

  if (allowedEmails.length === 0 && allowedDomains.length === 0) {
    return true;
  }

  if (allowedEmails.includes(normalizedEmail)) {
    return true;
  }

  return allowedDomains.some(domain => normalizedEmail.endsWith(`@${domain}`));
}

async function getSupabaseUserFromToken(token) {
  const config = getSupabaseConfig();
  if (!config || !token) return null;

  const response = await axios.get(`${config.url}/auth/v1/user`, {
    timeout: 10000,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${token}`
    }
  });

  return response.data;
}

async function requireSupabaseAuth(req, res, next) {
  if (req.path === '/auth-config' || !isSupabaseAuthRequired()) {
    return next();
  }

  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, error: 'Login obrigatório.' });
  }

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user || !isUserAllowed(user.email)) {
      return res.status(403).json({ success: false, error: 'Usuário não autorizado para este sistema.' });
    }

    req.authUser = {
      id: user.id,
      email: user.email
    };
    return next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
  }
}

async function supabaseRpc(functionName, payload) {
  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }

  try {
    const response = await axios.post(
      `${config.url}/rest/v1/rpc/${functionName}`,
      { p_secret: config.appSecret, ...payload },
      {
        timeout: 15000,
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (e) {
    const details = e.response ? JSON.stringify(e.response.data || {}) : e.message;
    console.warn(`Supabase RPC ${functionName} falhou: ${details}`);
    return null;
  }
}

function normalizeEnvironment(environment) {
  return environment === 'homologacao' ? 'homologacao' : 'producao';
}

function getNationalApiBaseUrl(environment) {
  return normalizeEnvironment(environment) === 'producao'
    ? 'https://adn.nfse.gov.br/contribuintes'
    : 'https://adn.producaorestrita.nfse.gov.br/contribuintes';
}

async function syncSupabaseCertificate(cert, active = true) {
  if (!cert) return null;

  return supabaseRpc('xml_nfse_upsert_certificate', {
    p_certificate_id: cert.id,
    p_filename: cert.originalName || cert.filename || 'certificado.pfx',
    p_cnpj: cert.cnpj || '',
    p_active: Boolean(active)
  });
}

async function syncSupabaseState({ certificateId, environment, cnpjConsulta, lastNsu, maxNsuSeen, status, nextAllowedAt = null, lastError = null }) {
  return supabaseRpc('xml_nfse_update_sync_state', {
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_cnpj_consulta: cnpjConsulta || '',
    p_last_nsu: Number(lastNsu || 0),
    p_max_nsu_seen: Number(maxNsuSeen || 0),
    p_status: status || 'idle',
    p_next_allowed_at: nextAllowedAt,
    p_last_error: lastError
  });
}

async function startSupabaseRun({ certificateId, environment, cnpjConsulta, startNsu }) {
  return supabaseRpc('xml_nfse_start_run', {
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_cnpj_consulta: cnpjConsulta || '',
    p_start_nsu: Number(startNsu || 0)
  });
}

async function finishSupabaseRun({ runId, status, endNsu = null, maxNsuSeen = null, documentsFound = 0, errorMessage = null }) {
  if (!runId) return null;

  return supabaseRpc('xml_nfse_finish_run', {
    p_run_id: runId,
    p_status: status,
    p_end_nsu: endNsu === null ? null : Number(endNsu),
    p_max_nsu_seen: maxNsuSeen === null ? null : Number(maxNsuSeen),
    p_documents_found: Number(documentsFound || 0),
    p_error_message: errorMessage
  });
}

async function syncSupabaseDocument({ certificateId, environment, doc }) {
  return supabaseRpc('xml_nfse_upsert_document', {
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_nsu: Number(doc.nsu || 0),
    p_tipo: doc.tipo || 'NFSE',
    p_chave: doc.chave || '',
    p_file_name: doc.arquivo || '',
    p_xml_sha256: doc.xmlSha256 || '',
    p_metadata: {
      numeroNfse: doc.numeroNfse,
      prestadorCnpj: doc.prestadorCnpj,
      prestadorNome: doc.prestadorNome,
      tomadorCnpj: doc.tomadorCnpj,
      tomadorNome: doc.tomadorNome,
      valorServico: doc.valorServico,
      dataEmissao: doc.dataEmissao,
      municipioPrestacao: doc.municipioPrestacao,
      codigoTributacao: doc.codigoTributacao,
      competencia: doc.competencia,
      status: doc.status
    }
  });
}

async function storeSupabaseXmlPayload({ token, certificateId, environment, nsu, fileName, xmlString }) {
  return supabaseRpc('xml_nfse_upsert_xml_payload', {
    p_token: token,
    p_certificate_id: certificateId,
    p_environment: normalizeEnvironment(environment),
    p_nsu: nsu === undefined || nsu === null ? null : Number(nsu),
    p_file_name: fileName,
    p_xml_content: xmlString
  });
}

async function getSupabaseXmlPayload(token) {
  return supabaseRpc('xml_nfse_get_xml_payload', {
    p_token: token
  });
}

async function listSupabaseXmlPayloads() {
  return supabaseRpc('xml_nfse_list_xml_payloads', {});
}

function getEnvCertificate() {
  const base64 = process.env.NFSE_CERT_PFX_BASE64;
  const passphrase = process.env.NFSE_CERT_PASSPHRASE;

  if (!base64 || !passphrase) {
    return null;
  }

  const normalizedBase64 = String(base64).replace(/\s/g, '');
  return {
    id: process.env.NFSE_CERT_ID || 'vercel-env-cert',
    originalName: process.env.NFSE_CERT_NAME || 'certificado-vercel.pfx',
    passphrase,
    cnpj: process.env.NFSE_CERT_CNPJ || '',
    createdAt: null,
    updatedAt: null,
    pfxBuffer: Buffer.from(normalizedBase64, 'base64'),
    source: 'env'
  };
}

function getCertificateBuffer(cert) {
  if (cert && cert.pfxBuffer) {
    return cert.pfxBuffer;
  }

  if (cert && cert.filePath) {
    return fs.readFileSync(cert.filePath);
  }

  return null;
}

function getCertificateDisplayName(cert) {
  const cn = cert.subject && cert.subject.getField('CN');
  return cn && cn.value ? cn.value : 'certificado sem CN';
}

function extractCnpjFromText(value) {
  const text = String(value || '');
  const colonMatch = text.match(/[:=]\s*(\d{14})\b/);
  if (colonMatch) return colonMatch[1];

  const matches = text.match(/\b\d{14}\b/g) || [];
  return matches.length === 1 ? matches[0] : null;
}

function extractCnpjFromAsn1Value(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const direct = extractCnpjFromText(value);
    if (direct) return direct;

    try {
      return extractCnpjFromAsn1Value(forge.asn1.fromDer(forge.util.createBuffer(value)));
    } catch (err) {
      return null;
    }
  }

  if (Array.isArray(value.value)) {
    for (const child of value.value) {
      const childCnpj = extractCnpjFromAsn1Value(child);
      if (childCnpj) return childCnpj;
    }
    return null;
  }

  if (typeof value.value === 'string') {
    return extractCnpjFromText(value.value);
  }

  return null;
}

function extractCertificateCnpj(cert) {
  const subjectAttrs = cert.subject && cert.subject.attributes ? cert.subject.attributes : [];

  for (const attr of subjectAttrs) {
    const attrId = String(attr.type || attr.name || attr.shortName || '').toLowerCase();
    if (attrId === '2.16.76.1.3.3' || attrId.includes('cnpj')) {
      const cnpj = extractCnpjFromText(attr.value);
      if (cnpj) return cnpj;
    }
  }

  const cn = cert.subject && cert.subject.getField('CN');
  if (cn && cn.value) {
    const cnpj = extractCnpjFromText(cn.value);
    if (cnpj) return cnpj;
  }

  for (const ext of cert.extensions || []) {
    if (Array.isArray(ext.altNames)) {
      for (const altName of ext.altNames) {
        const oid = String(altName.oid || altName.type || '').toLowerCase();
        if (oid === '2.16.76.1.3.3' || oid.includes('2.16.76.1.3.3')) {
          const cnpj = extractCnpjFromAsn1Value(altName.value) || extractCnpjFromText(altName.value);
          if (cnpj) return cnpj;
        }
      }
    }
  }

  return null;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validateCnpjConsultaRoot(cnpjConsulta, certificateCnpj) {
  const consulta = onlyDigits(cnpjConsulta);
  const certificado = onlyDigits(certificateCnpj);

  if (!consulta || !certificado || consulta.length !== 14 || certificado.length !== 14) {
    return null;
  }

  if (consulta.slice(0, 8) !== certificado.slice(0, 8)) {
    return 'O CNPJ para consulta deve ter a mesma raiz do CNPJ do certificado digital. Remova o CNPJ informado ou use um CNPJ da mesma empresa/grupo raiz.';
  }

  return null;
}

function getBagLocalKeyId(bag) {
  const values = bag && bag.attributes ? bag.attributes.localKeyId : null;
  const value = Array.isArray(values) ? values[0] : values;
  if (!value) return null;

  if (typeof value === 'string') {
    return forge.util.bytesToHex(value);
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('hex');
  }

  return String(value);
}

function selectLeafCertificateBag(certBags, keyBags) {
  const keyLocalIds = new Set(keyBags.map(getBagLocalKeyId).filter(Boolean));
  const matchingKeyBag = certBags.find(bag => keyLocalIds.has(getBagLocalKeyId(bag)));
  if (matchingKeyBag && matchingKeyBag.cert) {
    return matchingKeyBag;
  }

  return certBags.find(bag => {
    if (!bag.cert) return false;
    const basicConstraints = bag.cert.getExtension('basicConstraints');
    return !basicConstraints || basicConstraints.cA !== true;
  }) || certBags.find(bag => bag.cert);
}

function validateCertificateForNationalApi(pfxBuffer, passphrase) {
  let p12;
  try {
    const der = forge.util.createBuffer(pfxBuffer.toString('binary'));
    const asn1 = forge.asn1.fromDer(der);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
  } catch (err) {
    return {
      valid: false,
      error: `Senha ou certificado invalido. Nao foi possivel abrir o PFX/P12: ${err.message}`
    };
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])
  ];

  if (certBags.length === 0) {
    return {
      valid: false,
      error: 'O arquivo PFX/P12 nao contem certificado digital.'
    };
  }

  if (keyBags.length === 0) {
    return {
      valid: false,
      error: 'O arquivo PFX/P12 nao contem chave privada. Exporte o certificado A1 incluindo a chave privada.'
    };
  }

  const certificates = certBags.map(bag => bag.cert).filter(Boolean);
  const leafBag = selectLeafCertificateBag(certBags, keyBags);
  const leaf = leafBag && leafBag.cert;
  if (!leaf) {
    return {
      valid: false,
      error: 'O arquivo PFX/P12 nao contem certificado digital utilizavel.'
    };
  }

  const now = new Date();
  if (leaf.validity.notBefore > now) {
    return {
      valid: false,
      error: `Certificado ainda nao esta valido. Inicio da validade: ${leaf.validity.notBefore.toISOString()}`
    };
  }

  if (leaf.validity.notAfter < now) {
    return {
      valid: false,
      error: `Certificado expirado em ${leaf.validity.notAfter.toISOString()}. Envie um certificado A1 valido.`
    };
  }

  const basicConstraints = leaf.getExtension('basicConstraints');
  if (basicConstraints && basicConstraints.cA === true) {
    return {
      valid: false,
      error: 'O certificado selecionado e de Autoridade Certificadora, nao de transmissao. Envie o certificado A1 da empresa.'
    };
  }

  if (certificates.length < 2) {
    return {
      valid: false,
      error: 'O PFX/P12 nao contem a cadeia de certificacao completa. Reexporte o A1 incluindo todos os certificados no caminho de certificacao e envie novamente.'
    };
  }

  const extKeyUsage = leaf.getExtension('extKeyUsage');
  if (extKeyUsage && !extKeyUsage.clientAuth) {
    return {
      valid: false,
      error: 'O certificado nao possui uso de Autenticacao Cliente. A API Nacional exige certificado A1/e-CNPJ apto para mTLS.'
    };
  }

  return {
    valid: true,
    subject: getCertificateDisplayName(leaf),
    cnpj: extractCertificateCnpj(leaf),
    certificatesInPfx: certificates.length,
    validUntil: leaf.validity.notAfter.toISOString()
  };
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

function isNationalApiFiscalStatus(status) {
  return status >= 200 && status < 300 || status === 400 || status === 404;
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

function useRemoteCertificateStorage() {
  return IS_VERCEL || process.env.CERT_STORAGE_MODE === 'supabase';
}

function getCertificateEncryptionKey() {
  let raw = process.env.CERT_ENCRYPTION_KEY;

  // Se não estiver nas variáveis de ambiente e não for Vercel, tenta ler do arquivo local
  if (!raw && !IS_VERCEL) {
    const keyPath = path.join(CONFIG_DIR, 'cert-encryption-key.txt');
    if (fs.existsSync(keyPath)) {
      try {
        raw = fs.readFileSync(keyPath, 'utf8');
      } catch (e) {
        console.error('Erro ao ler cert-encryption-key.txt:', e.message);
      }
    }
  }

  if (!raw) return null;

  // Limpa possíveis espaços nas extremidades e aspas decorrentes de cópia/cola
  raw = raw.trim().replace(/^["']|["']$/g, '');

  let key;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    try {
      key = Buffer.from(raw, 'base64');
    } catch (e) {
      key = Buffer.alloc(0);
    }

    if (key.length !== 32) {
      key = Buffer.from(raw, 'utf8');
    }
  }

  return key.length === 32 ? key : null;
}

function getCertificateEncryptionKeyDiagnostics() {
  let raw = process.env.CERT_ENCRYPTION_KEY;
  let source = raw ? 'env' : null;

  if (!raw && !IS_VERCEL) {
    const keyPath = path.join(CONFIG_DIR, 'cert-encryption-key.txt');
    if (fs.existsSync(keyPath)) {
      try {
        raw = fs.readFileSync(keyPath, 'utf8');
        source = 'config/cert-encryption-key.txt';
      } catch (e) {
        return {
          configured: false,
          validLength: false,
          source: 'config/cert-encryption-key.txt',
          error: e.message
        };
      }
    }
  }

  if (!raw) {
    return {
      configured: false,
      validLength: false,
      source: null
    };
  }

  raw = raw.trim().replace(/^["']|["']$/g, '');
  const key = getCertificateEncryptionKey();

  return {
    configured: true,
    validLength: Boolean(key),
    source,
    format: /^[0-9a-f]{64}$/i.test(raw) ? 'hex' : 'base64-or-utf8',
    rawLength: raw.length
  };
}

function encryptCertificateValue(value) {
  const key = getCertificateEncryptionKey();
  if (!key) {
    throw new Error('CERT_ENCRYPTION_KEY deve ter 32 bytes. Use 64 caracteres hexadecimais ou Base64 de 32 bytes.');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64')
  };
}

function decryptCertificateValue(payload) {
  const key = getCertificateEncryptionKey();
  if (!key) {
    throw new Error('CERT_ENCRYPTION_KEY deve ter 32 bytes para descriptografar certificados.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]);
}

async function listRemoteCertificates() {
  const result = await supabaseRpc('xml_nfse_list_certificates', {});
  return Array.isArray(result) ? result : [];
}

async function setRemoteActiveCertificate(certificateId) {
  return supabaseRpc('xml_nfse_set_active_certificate', {
    p_certificate_id: certificateId
  });
}

async function deleteRemoteCertificate(certificateId) {
  return supabaseRpc('xml_nfse_delete_certificate', {
    p_certificate_id: certificateId
  });
}

async function upsertRemoteCertificateSecret({ id, filename, cnpj, active, pfxBuffer, passphrase }) {
  const encryptedPfx = encryptCertificateValue(pfxBuffer);
  const encryptedPassphrase = encryptCertificateValue(Buffer.from(passphrase, 'utf8'));

  return supabaseRpc('xml_nfse_upsert_certificate_secret', {
    p_certificate_id: id,
    p_filename: filename,
    p_cnpj: cnpj || '',
    p_active: Boolean(active),
    p_pfx_ciphertext: encryptedPfx.ciphertext,
    p_pfx_iv: encryptedPfx.iv,
    p_pfx_auth_tag: encryptedPfx.authTag,
    p_passphrase_ciphertext: encryptedPassphrase.ciphertext,
    p_passphrase_iv: encryptedPassphrase.iv,
    p_passphrase_auth_tag: encryptedPassphrase.authTag
  });
}

async function resolveRemoteCertificate(certificateId) {
  let id = certificateId;
  if (!id) {
    const certificates = await listRemoteCertificates();
    const active = certificates.find(cert => cert.active) || certificates[0];
    id = active ? active.id : null;
  }

  if (!id) {
    const envCert = getEnvCertificate();
    return envCert || null;
  }

  const row = await supabaseRpc('xml_nfse_get_certificate_secret', {
    p_certificate_id: id
  });
  if (!row || !row.pfx_ciphertext || !row.passphrase_ciphertext) {
    const envCert = getEnvCertificate();
    return envCert && envCert.id === id ? envCert : null;
  }

  return {
    id: row.id,
    originalName: row.filename,
    cnpj: row.cnpj || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    passphrase: decryptCertificateValue({
      ciphertext: row.passphrase_ciphertext,
      iv: row.passphrase_iv,
      authTag: row.passphrase_auth_tag
    }).toString('utf8'),
    pfxBuffer: decryptCertificateValue({
      ciphertext: row.pfx_ciphertext,
      iv: row.pfx_iv,
      authTag: row.pfx_auth_tag
    }),
    source: 'supabase'
  };
}

async function resolveCertificateForRequest(certificateId) {
  if (useRemoteCertificateStorage()) {
    return resolveRemoteCertificate(certificateId);
  }

  return resolveCertificate(certificateId);
}

function readCertificatesIndex() {
  const envCert = getEnvCertificate();
  if (envCert && IS_VERCEL) {
    return {
      activeCertificateId: envCert.id,
      certificates: [envCert]
    };
  }

  if (!fs.existsSync(CERTS_INDEX_FILE)) {
    return { activeCertificateId: null, certificates: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CERTS_INDEX_FILE, 'utf8'));
    return {
      activeCertificateId: parsed.activeCertificateId || null,
      certificates: Array.isArray(parsed.certificates) ? parsed.certificates : []
    };
  } catch (e) {
    console.error('Erro ao ler certificates.json:', e);
    return { activeCertificateId: null, certificates: [] };
  }
}

function saveCertificatesIndex(index) {
  if (IS_VERCEL) return;
  fs.writeFileSync(CERTS_INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
}

function sanitizeCertificate(cert) {
  return {
    id: cert.id,
    filename: cert.originalName || cert.filename || 'certificado.pfx',
    cnpj: cert.cnpj || '',
    active: Boolean(cert.active),
    createdAt: cert.createdAt || cert.created_at || null,
    updatedAt: cert.updatedAt || cert.updated_at || null
  };
}

function migrateLegacyCertificateIfNeeded() {
  const index = readCertificatesIndex();
  if (index.certificates.length > 0 || !fs.existsSync(CERT_FILE)) {
    return index;
  }

  const settings = getSettings();
  if (!settings || !settings.passphrase) {
    return index;
  }

  const id = crypto.randomUUID();
  const storedName = `${id}.pfx`;
  fs.copyFileSync(CERT_FILE, path.join(CERTS_DIR, storedName));

  const cert = {
    id,
    originalName: settings.filename || 'certificado.pfx',
    storedName,
    passphrase: settings.passphrase,
    cnpj: settings.cnpj || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const nextIndex = {
    activeCertificateId: id,
    certificates: [cert]
  };
  saveCertificatesIndex(nextIndex);
  saveSettings({
    ...settings,
    activeCertificateId: id
  });
  return nextIndex;
}

function getCertificatesIndex() {
  return migrateLegacyCertificateIfNeeded();
}

function resolveCertificate(certificateId) {
  const envCert = getEnvCertificate();
  if (envCert && (!certificateId || certificateId === envCert.id)) {
    return envCert;
  }

  const index = getCertificatesIndex();
  const id = certificateId || index.activeCertificateId;
  const cert = index.certificates.find(item => item.id === id);

  if (!cert) {
    return null;
  }

  const filePath = path.join(CERTS_DIR, cert.storedName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return {
    ...cert,
    filePath
  };
}

function setActiveCertificate(certificateId) {
  const envCert = getEnvCertificate();
  if (envCert && certificateId === envCert.id) {
    return envCert;
  }

  if (IS_VERCEL) return null;

  const index = getCertificatesIndex();
  const exists = index.certificates.some(cert => cert.id === certificateId);
  if (!exists) return null;

  index.activeCertificateId = certificateId;
  saveCertificatesIndex(index);

  const settings = getSettings() || {};
  saveSettings({
    ...settings,
    activeCertificateId: certificateId
  });

  return resolveCertificate(certificateId);
}

// Regex robusto para extrair metadados básicos do XML da NFS-e sem dependências externas
function extractTag(xmlString, tagName) {
  const match = xmlString.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? match[1].trim() : null;
}

function extractSection(xmlString, tagName) {
  const match = xmlString.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? match[1] : null;
}

function normalizeDate(value) {
  if (!value) return 'N/A';
  return String(value).split('T')[0];
}

function buildXmlToken() {
  return crypto.randomBytes(16).toString('hex');
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
    // Chave de Acesso
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

    // Isolando a seção do Emitente/Prestador
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

    // Isolando a seção do Tomador
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

    // Valor do Serviço
    const valMatch = xmlString.match(/<vServ>([^<]+)<\/vServ>/i) || 
                     xmlString.match(/<vServPrest>([^<]+)<\/vServPrest>/i) ||
                     xmlString.match(/<valorServico>([^<]+)<\/valorServico>/i) ||
                     xmlString.match(/<vLiq>([^<]+)<\/vLiq>/i);
    if (valMatch) metadata.valorServico = valMatch[1];

    // Data de Emissão
    const dataMatch = xmlString.match(/<dhEmit>([^<]+)<\/dhEmit>/i) || 
                      xmlString.match(/<dhEmi>([^<]+)<\/dhEmi>/i) ||
                      xmlString.match(/<dhProc>([^<]+)<\/dhProc>/i) ||
                      xmlString.match(/<dEmi>([^<]+)<\/dEmi>/i);
    if (dataMatch) {
      metadata.dataEmissao = dataMatch[1].split('T')[0]; // Apenas a data
    }

    // Descrição do Serviço
    const descMatch = xmlString.match(/<xDescServ>([^<]+)<\/xDescServ>/i) ||
                      xmlString.match(/<descServico>([^<]+)<\/descServico>/i);
    if (descMatch) metadata.descricaoServico = descMatch[1];

    const eventSection = extractSection(xmlString, 'pedRegEvento') || extractSection(xmlString, 'infEvento');
    if (eventSection) {
      metadata.status = 'Evento';
      metadata.eventoDescricao = extractTag(eventSection, 'xDesc') || metadata.eventoDescricao;
      metadata.eventoMotivo = extractTag(eventSection, 'xMotivo') || metadata.eventoMotivo;
      metadata.dataEmissao = normalizeDate(extractTag(eventSection, 'dhEvento') || extractTag(xmlString, 'dhProc'));
      metadata.descricaoServico = metadata.eventoDescricao !== 'N/A' ? metadata.eventoDescricao : metadata.descricaoServico;
    }

  } catch (e) {
    console.error('Erro ao fazer parse dos metadados do XML:', e);
  }

  return metadata;
}

// ----------------------------------------------------
// ROTAS DA API
// ----------------------------------------------------

// 1. Status e lista de certificados
app.get('/api/certificate-status', async (req, res) => {
  if (useRemoteCertificateStorage()) {
    const certificates = await listRemoteCertificates();
    const envCert = getEnvCertificate();
    const allCertificates = certificates.length > 0 ? certificates : (envCert ? [sanitizeCertificate(envCert)] : []);
    const activeCert = allCertificates.find(cert => cert.active) || allCertificates[0] || null;

    return res.json({
      active: Boolean(activeCert),
      activeCertificateId: activeCert ? activeCert.id : null,
      filename: activeCert ? (activeCert.filename || activeCert.originalName || 'certificado.pfx') : null,
      cnpj: activeCert ? (activeCert.cnpj || 'Não cadastrado') : null,
      certificates: allCertificates.map(sanitizeCertificate)
    });
  }

  const index = getCertificatesIndex();
  const activeCert = resolveCertificate(index.activeCertificateId);

  return res.json({
    active: Boolean(activeCert),
    activeCertificateId: activeCert ? activeCert.id : null,
    filename: activeCert ? (activeCert.originalName || activeCert.filename || 'certificado.pfx') : null,
    cnpj: activeCert ? (activeCert.cnpj || 'Não cadastrado') : null,
    certificates: index.certificates.map(sanitizeCertificate)
  });
});

app.get('/api/certificates', async (req, res) => {
  if (useRemoteCertificateStorage()) {
    const certificates = await listRemoteCertificates();
    const envCert = getEnvCertificate();
    const allCertificates = certificates.length > 0 ? certificates : (envCert ? [sanitizeCertificate(envCert)] : []);
    const activeCert = allCertificates.find(cert => cert.active) || allCertificates[0] || null;

    return res.json({
      success: true,
      activeCertificateId: activeCert ? activeCert.id : null,
      certificates: allCertificates.map(sanitizeCertificate)
    });
  }

  const index = getCertificatesIndex();
  return res.json({
    success: true,
    activeCertificateId: index.activeCertificateId,
    certificates: index.certificates.map(sanitizeCertificate)
  });
});

app.get('/api/certificate-diagnostics', async (req, res) => {
  const environment = normalizeEnvironment(req.query.environment || 'producao');
  const certificateId = req.query.certificateId || null;

  try {
    const selectedCertificate = await resolveCertificateForRequest(certificateId);
    if (!selectedCertificate) {
      return res.status(400).json({
        success: false,
        remoteStorage: useRemoteCertificateStorage(),
        encryptionKey: getCertificateEncryptionKeyDiagnostics(),
        environment,
        nationalApiBaseUrl: getNationalApiBaseUrl(environment),
        error: 'Certificado nao configurado ou nao encontrado.'
      });
    }

    const pfxBuffer = getCertificateBuffer(selectedCertificate);
    if (!pfxBuffer) {
      return res.status(400).json({
        success: false,
        remoteStorage: useRemoteCertificateStorage(),
        encryptionKey: getCertificateEncryptionKeyDiagnostics(),
        environment,
        nationalApiBaseUrl: getNationalApiBaseUrl(environment),
        certificate: sanitizeCertificate(selectedCertificate),
        error: 'Arquivo ou variavel do certificado nao encontrada.'
      });
    }

    const certificateValidation = validateCertificateForNationalApi(pfxBuffer, selectedCertificate.passphrase);

    return res.json({
      success: certificateValidation.valid,
      remoteStorage: useRemoteCertificateStorage(),
      encryptionKey: getCertificateEncryptionKeyDiagnostics(),
      environment,
      nationalApiBaseUrl: getNationalApiBaseUrl(environment),
      certificate: sanitizeCertificate(selectedCertificate),
      pfx: {
        decryptable: true,
        valid: certificateValidation.valid,
        subject: certificateValidation.subject || null,
        cnpjExtracted: certificateValidation.cnpj || null,
        certificatesInPfx: certificateValidation.certificatesInPfx || null,
        validUntil: certificateValidation.validUntil || null,
        error: certificateValidation.error || null
      }
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      remoteStorage: useRemoteCertificateStorage(),
      encryptionKey: getCertificateEncryptionKeyDiagnostics(),
      environment,
      nationalApiBaseUrl: getNationalApiBaseUrl(environment),
      error: 'Falha ao diagnosticar certificado: ' + e.message
    });
  }
});

// 2. Upload do Certificado
app.post('/api/upload-certificate', upload.single('pfx'), async (req, res) => {
  try {
    const pfxBuffer = req.file ? req.file.buffer : null;
    const passphrase = req.body.passphrase;
    const cnpj = req.body.cnpj || '';

    if (!pfxBuffer) {
      return res.status(400).json({ success: false, error: 'Arquivo do certificado é obrigatório.' });
    }
    if (!passphrase) {
      return res.status(400).json({ success: false, error: 'Senha do certificado é obrigatória.' });
    }

    try {
      new https.Agent({
        pfx: pfxBuffer,
        passphrase: passphrase
      });
    } catch (err) {
      return res.status(400).json({ success: false, error: 'Senha ou Certificado inválidos. Detalhes: ' + err.message });
    }

    const certificateValidation = validateCertificateForNationalApi(pfxBuffer, passphrase);
    if (!certificateValidation.valid) {
      return res.status(400).json({
        success: false,
        error: certificateValidation.error
      });
    }

    const requestCnpj = onlyDigits(cnpj);
    if (cnpj && requestCnpj.length !== 14) {
      return res.status(400).json({
        success: false,
        error: 'CNPJ informado no cadastro do certificado deve conter 14 digitos.'
      });
    }

    const resolvedCnpj = requestCnpj || certificateValidation.cnpj || '';
    if (!resolvedCnpj) {
      return res.status(400).json({
        success: false,
        error: 'Nao foi possivel identificar com seguranca o CNPJ do titular no certificado. Informe manualmente o CNPJ da empresa ao cadastrar o A1.'
      });
    }

    if (useRemoteCertificateStorage()) {
      const cert = {
        id: crypto.randomUUID(),
        originalName: req.file.originalname || 'certificado.pfx',
        cnpj: resolvedCnpj,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const saved = await upsertRemoteCertificateSecret({
        id: cert.id,
        filename: cert.originalName,
        cnpj: resolvedCnpj,
        active: true,
        pfxBuffer,
        passphrase
      });

      if (!saved || !saved.success) {
        return res.status(500).json({ success: false, error: 'Não foi possível salvar o certificado criptografado no Supabase.' });
      }

      return res.json({
        success: true,
        message: 'Certificado salvo, criptografado e validado com sucesso!',
        activeCertificateId: cert.id,
        certificate: sanitizeCertificate(cert)
      });
    }

    const id = crypto.randomUUID();
    const extension = path.extname(req.file.originalname || '.pfx').toLowerCase();
    const storedName = `${id}${extension === '.p12' ? '.p12' : '.pfx'}`;
    fs.writeFileSync(path.join(CERTS_DIR, storedName), pfxBuffer);

    const index = getCertificatesIndex();
    const cert = {
      id,
      originalName: req.file.originalname || 'certificado.pfx',
      storedName,
      passphrase,
      cnpj: resolvedCnpj,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    index.certificates.push(cert);
    index.activeCertificateId = id;
    saveCertificatesIndex(index);

    const settings = getSettings() || {};
    saveSettings({
      ...settings,
      activeCertificateId: id
    });

    await syncSupabaseCertificate(cert, true);

    return res.json({
      success: true,
      message: 'Certificado salvo e validado com sucesso!',
      activeCertificateId: id,
      certificate: sanitizeCertificate(cert)
    });
  } catch (e) {
    console.error('Erro no upload do certificado:', e);
    return res.status(500).json({ success: false, error: 'Erro interno no servidor: ' + e.message });
  }
});

app.post('/api/select-certificate', async (req, res) => {
  const { certificateId } = req.body || {};
  if (!certificateId) {
    return res.status(400).json({ success: false, error: 'certificateId é obrigatório.' });
  }

  if (useRemoteCertificateStorage()) {
    const selected = await setRemoteActiveCertificate(certificateId);
    if (!selected || !selected.success) {
      return res.status(404).json({ success: false, error: 'Certificado não encontrado.' });
    }

    const certificates = await listRemoteCertificates();
    const cert = certificates.find(item => item.id === certificateId);
    return res.json({
      success: true,
      activeCertificateId: certificateId,
      certificate: cert ? sanitizeCertificate(cert) : null
    });
  }

  const cert = setActiveCertificate(certificateId);
  if (!cert) {
    return res.status(404).json({ success: false, error: 'Certificado não encontrado.' });
  }

  await syncSupabaseCertificate(cert, true);

  return res.json({
    success: true,
    activeCertificateId: cert.id,
    certificate: sanitizeCertificate(cert)
  });
});

// 3. Remover Certificado
app.post('/api/remove-certificate', async (req, res) => {
  try {
    const { certificateId } = req.body || {};
    if (useRemoteCertificateStorage()) {
      if (!certificateId) {
        return res.status(400).json({ success: false, error: 'certificateId é obrigatório para remover certificado remoto.' });
      }

      const removed = await deleteRemoteCertificate(certificateId);
      if (!removed || !removed.success) {
        return res.status(404).json({ success: false, error: 'Certificado não encontrado.' });
      }

      const certificates = await listRemoteCertificates();
      const activeCert = certificates.find(item => item.active) || certificates[0] || null;
      return res.json({
        success: true,
        activeCertificateId: activeCert ? activeCert.id : null,
        certificates: certificates.map(sanitizeCertificate)
      });
    }

    const index = getCertificatesIndex();
    const idToRemove = certificateId || index.activeCertificateId;
    const cert = index.certificates.find(item => item.id === idToRemove);

    if (!cert) {
      return res.status(404).json({ success: false, error: 'Certificado não encontrado.' });
    }

    const filePath = path.join(CERTS_DIR, cert.storedName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    index.certificates = index.certificates.filter(item => item.id !== idToRemove);
    if (index.activeCertificateId === idToRemove) {
      index.activeCertificateId = index.certificates[0] ? index.certificates[0].id : null;
    }
    saveCertificatesIndex(index);

    const settings = getSettings() || {};
    saveSettings({
      ...settings,
      activeCertificateId: index.activeCertificateId
    });

    return res.json({
      success: true,
      activeCertificateId: index.activeCertificateId,
      certificates: index.certificates.map(sanitizeCertificate)
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Erro ao remover certificado: ' + e.message });
  }
});

// 4. Limpar Downloads Locais
app.post('/api/clear-downloads', (req, res) => {
  try {
    let removedFiles = 0;
    if (!IS_VERCEL && fs.existsSync(DOWNLOADS_DIR)) {
      const files = fs.readdirSync(DOWNLOADS_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(DOWNLOADS_DIR, file));
      }
      removedFiles = files.length;
    }
    const cacheCount = xmlCache.size;
    xmlCache.clear();
    return res.json({ success: true, count: removedFiles + cacheCount });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Erro ao limpar pasta de downloads: ' + e.message });
  }
});

// 5. Consulta em Lote (Um bloco de até 50 registros por vez)
app.post('/api/fetch-batch', async (req, res) => {
  let selectedCertificate = null;
  let supabaseRunId = null;
  let requestStartNsu = 0;
  let requestEnvironment = 'producao';
  let requestCnpjConsulta = '';

  try {
    const { startNsu, environment, cnpjConsulta, sortOrder, certificateId } = req.body;
    requestStartNsu = Number(startNsu || 0);
    requestEnvironment = normalizeEnvironment(environment);
    requestCnpjConsulta = cnpjConsulta || '';
    
    if (startNsu === undefined || !environment) {
      return res.status(400).json({ success: false, error: 'Parâmetros startNsu e environment são obrigatórios.' });
    }

    selectedCertificate = await resolveCertificateForRequest(certificateId);
    if (!selectedCertificate) {
      return res.status(400).json({ success: false, error: 'Certificado não configurado ou não encontrado. Selecione um certificado antes da consulta.' });
    }

    requestCnpjConsulta = resolveCnpjConsulta(requestCnpjConsulta, selectedCertificate.cnpj);

    const cnpjRootError = validateCnpjConsultaRoot(requestCnpjConsulta, selectedCertificate.cnpj);
    if (cnpjRootError) {
      return res.status(400).json({ success: false, error: cnpjRootError });
    }

    await syncSupabaseCertificate(selectedCertificate, true);
    supabaseRunId = await startSupabaseRun({
      certificateId: selectedCertificate.id,
      environment: requestEnvironment,
      cnpjConsulta: requestCnpjConsulta,
      startNsu: requestStartNsu
    });

    const pfxBuffer = getCertificateBuffer(selectedCertificate);
    if (!pfxBuffer) {
      return res.status(400).json({ success: false, error: 'Arquivo ou variável do certificado não encontrada.' });
    }

    const certificateValidation = validateCertificateForNationalApi(pfxBuffer, selectedCertificate.passphrase);
    if (!certificateValidation.valid) {
      return res.status(400).json({ success: false, error: certificateValidation.error });
    }

    // Configurar o Agent HTTPS com o certificado digital
    const httpsAgent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: selectedCertificate.passphrase,
      rejectUnauthorized: false // Desabilita erro em homologações com certificados auto-assinados
    });

    // Definir URL Base
    const baseUrl = getNationalApiBaseUrl(requestEnvironment);

    // Montar URL do endpoint
    const url = buildDfeUrl(baseUrl, requestStartNsu, requestCnpjConsulta);

    console.log(`Fazendo requisição à API Nacional: ${url}`);

    const response = await axios.get(url, {
      httpsAgent,
      timeout: 15000,
      validateStatus: isNationalApiFiscalStatus,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'NFS-e Batch Downloader Local'
      }
    });

    const data = response.data;
    
    // Validar se o retorno contém a estrutura esperada
    if (!data) {
      return res.status(500).json({ success: false, error: 'Retorno vazio da API Nacional.' });
    }

    // Log das chaves da resposta para diagnóstico
    console.log(`Resposta HTTP ${response.status} | Chaves: ${Object.keys(data).join(', ')}`);
    console.log(`StatusProcessamento: ${data.StatusProcessamento || 'N/A'}`);

    const nationalStatus = getNationalApiStatus(data);
    if (nationalStatus === 'REJEICAO') {
      const errorMsg = formatNationalApiRejection(data) || 'Rejeicao da API Nacional sem detalhes.';

      await syncSupabaseState({
        certificateId: selectedCertificate.id,
        environment: requestEnvironment,
        cnpjConsulta: requestCnpjConsulta,
        lastNsu: requestStartNsu,
        maxNsuSeen: requestStartNsu,
        status: 'error',
        lastError: errorMsg
      });
      await finishSupabaseRun({
        runId: supabaseRunId,
        status: 'error',
        endNsu: requestStartNsu,
        maxNsuSeen: requestStartNsu,
        documentsFound: 0,
        errorMessage: errorMsg
      });

      return res.status(400).json({
        success: false,
        error: errorMsg,
        nationalApi: buildNationalApiContext(response, url, requestEnvironment, requestCnpjConsulta)
      });
    }

    // Extrair ultNSU e maxNSU
    // A API Nacional pode não retornar esses campos — calculamos a partir dos documentos
    let ultNSU = getResponseNsu(data, ['ultNSU', 'UltNSU', 'ultNsu', 'UltimoNSU', 'ultimoNSU']);
    let maxNSU = getResponseNsu(data, ['maxNSU', 'MaxNSU', 'maxNsu', 'maiorNSU', 'MaiorNSU']);

    // Encontrar a lista de documentos no JSON
    // A API Nacional retorna os documentos em "LoteDFe"
    let documentsList = [];
    if (data.LoteDFe && Array.isArray(data.LoteDFe)) {
      documentsList = data.LoteDFe;
    } else if (data.loteDFe && Array.isArray(data.loteDFe)) {
      documentsList = data.loteDFe;
    } else if (Array.isArray(data)) {
      documentsList = data;
    } else {
      // Fallback: procurar qualquer chave que contenha um array de objetos (com ArquivoXml)
      const keys = Object.keys(data);
      for (const k of keys) {
        if (Array.isArray(data[k]) && data[k].length > 0 && data[k][0].ArquivoXml) {
          documentsList = data[k];
          break;
        }
      }
      if (documentsList.length === 0 && (data.ArquivoXml || data.conteudo || data.docZip)) {
        // Tratar objeto único como um array de 1 item
        documentsList = [data];
      }
    }

    // Se ultNSU/maxNSU não vieram na resposta, calcular a partir dos documentos
    if (ultNSU === null && documentsList.length > 0) {
      const nsus = documentsList.map(d => d.NSU || d.nsu || 0);
      ultNSU = Math.max(...nsus);
    }
    if (ultNSU === null) ultNSU = requestStartNsu;
    
    if (maxNSU === null) {
      if (documentsList.length === 50) {
        maxNSU = ultNSU + 1; // Indica que há mais páginas a buscar
      } else {
        maxNSU = ultNSU; // Fim dos documentos
      }
    }

    console.log(`Documentos encontrados na fila: ${documentsList.length} | ultNSU: ${ultNSU} | maxNSU: ${maxNSU}`);

    const processedDocs = [];

    // Processar cada documento
    for (const doc of documentsList) {
      // Procurar pela string Base64 compactada
      // A API Nacional retorna em "ArquivoXml" (PascalCase)
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

        // 3. Extrair metadados para o frontend
        const meta = parseXmlMetadata(xmlString, docNsu);

        // 4. Usar a chave de acesso que a API já retorna (mais confiável)
        const chaveAcesso = docChave || meta.chave;
        const safeChave = chaveAcesso !== 'N/A' ? chaveAcesso : `NSU_${docNsu}`;
        const fileName = `${docTipo}_NSU_${docNsu}_${safeChave}.xml`;
        const token = buildXmlToken();
        const xmlSha256 = crypto.createHash('sha256').update(xmlString, 'utf8').digest('hex');
        xmlCache.set(token, {
          fileName,
          xmlString,
          createdAt: Date.now(),
          certificateId: selectedCertificate.id,
          environment: requestEnvironment,
          nsu: docNsu
        });

        await storeSupabaseXmlPayload({
          token,
          certificateId: selectedCertificate.id,
          environment: requestEnvironment,
          nsu: docNsu,
          fileName,
          xmlString
        });

        console.log(`[OK] NSU ${docNsu} | ${docTipo} | Chave: ${chaveAcesso} | XML pronto para download sob demanda.`);

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

    let menorDataLote = null;
    let maiorDataLote = null;

    if (processedDocs.length > 0) {
      const datas = processedDocs
        .map(d => d.dataEmissao)
        .filter(d => d !== 'N/A' && d);
        
      if (datas.length > 0) {
        datas.sort();
        menorDataLote = datas[0];
        maiorDataLote = datas[datas.length - 1];
      }
    }

    processedDocs.sort((a, b) => {
      const aNsu = Number(a.nsu || 0);
      const bNsu = Number(b.nsu || 0);
      return sortOrder === 'desc' ? bNsu - aNsu : aNsu - bNsu;
    });

    for (const doc of processedDocs) {
      await syncSupabaseDocument({
        certificateId: selectedCertificate.id,
        environment: requestEnvironment,
        doc
      });
    }

    await syncSupabaseState({
      certificateId: selectedCertificate.id,
      environment: requestEnvironment,
      cnpjConsulta: requestCnpjConsulta,
      lastNsu: ultNSU,
      maxNsuSeen: maxNSU,
      status: ultNSU >= maxNSU ? 'completed' : 'running'
    });

    await finishSupabaseRun({
      runId: supabaseRunId,
      status: 'completed',
      endNsu: ultNSU,
      maxNsuSeen: maxNSU,
      documentsFound: processedDocs.length
    });

    return res.json({
      success: true,
      ultNSU: ultNSU,
      maxNSU: maxNSU,
      totalFila: documentsList.length,
      menorDataLote: menorDataLote,
      maiorDataLote: maiorDataLote,
      documentos: processedDocs
    });

  } catch (e) {
    console.error('Erro na requisição à API da NFS-e:', e);

    // Tratar o HTTP 404 (Nenhum documento localizado) como um fim de sincronização bem-sucedido
    if (e.response && e.response.status === 404) {
      const data = e.response.data;
      if (data && (data.StatusProcessamento === 'NENHUM_DOCUMENTO_LOCALIZADO' || 
                   (data.Erros && data.Erros.some(err => err.Codigo === 'E2220')))) {
        const fallbackNsu = req.body.startNsu !== undefined ? parseInt(req.body.startNsu) : 0;
        if (selectedCertificate) {
          await syncSupabaseState({
            certificateId: selectedCertificate.id,
            environment: requestEnvironment,
            cnpjConsulta: requestCnpjConsulta,
            lastNsu: fallbackNsu,
            maxNsuSeen: fallbackNsu,
            status: 'completed'
          });
          await finishSupabaseRun({
            runId: supabaseRunId,
            status: 'completed',
            endNsu: fallbackNsu,
            maxNsuSeen: fallbackNsu,
            documentsFound: 0
          });
        }
        return res.json({
          success: true,
          ultNSU: fallbackNsu,
          maxNSU: fallbackNsu,
          documentos: []
        });
      }
    }

    let errorMsg = e.message;
    if (e.response) {
      const nationalApiRejection = formatNationalApiRejection(e.response.data);
      if (nationalApiRejection) {
        errorMsg = nationalApiRejection;
      } else if (e.response.status === 496) {
        errorMsg = 'Erro 496: Certificado não fornecido ou inválido para o mTLS da Receita Federal.';
      } else if (e.response.status === 403) {
        errorMsg = 'Erro 403: Acesso Proibido. O certificado não tem permissão para este CNPJ ou o ambiente bloqueou a conexão.';
      } else if (e.response.status === 401) {
        errorMsg = 'Erro 401: Não autorizado. Verifique as credenciais do certificado.';
      } else if (e.response.status === 429 || e.response.status === 656) {
        errorMsg = 'Erro 429/656: Consumo Indevido. Aguarde 1 hora antes de consultar novamente.';
      } else {
        errorMsg = `Erro ${e.response.status} retornado pelo servidor nacional: ${JSON.stringify(e.response.data || '')}`;
      }
    }

    if (selectedCertificate) {
      const nextAllowedAt = /429|656|Consumo Indevido/i.test(errorMsg)
        ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
        : null;

      await syncSupabaseState({
        certificateId: selectedCertificate.id,
        environment: requestEnvironment,
        cnpjConsulta: requestCnpjConsulta,
        lastNsu: requestStartNsu,
        maxNsuSeen: requestStartNsu,
        status: 'error',
        nextAllowedAt,
        lastError: errorMsg
      });
      await finishSupabaseRun({
        runId: supabaseRunId,
        status: 'error',
        endNsu: requestStartNsu,
        maxNsuSeen: requestStartNsu,
        documentsFound: 0,
        errorMessage: errorMsg
      });
    }

    return res.status(500).json({ success: false, error: errorMsg });
  }
});

// 5.b Descobrir último NSU quando o ADN informa maxNSU
app.post('/api/discover-nsu', async (req, res) => {
  try {
    const { environment, cnpjConsulta, certificateId } = req.body;
    const requestEnvironment = normalizeEnvironment(environment);
    let requestCnpjConsulta = cnpjConsulta || '';
    
    const selectedCertificate = await resolveCertificateForRequest(certificateId);
    requestCnpjConsulta = resolveCnpjConsulta(requestCnpjConsulta, selectedCertificate?.cnpj);
    if (!selectedCertificate) {
      return res.status(400).json({ success: false, error: 'Certificado não configurado ou não encontrado.' });
    }

    const cnpjRootError = validateCnpjConsultaRoot(requestCnpjConsulta, selectedCertificate.cnpj);
    if (cnpjRootError) {
      return res.status(400).json({ success: false, error: cnpjRootError });
    }

    const pfxBuffer = getCertificateBuffer(selectedCertificate);
    if (!pfxBuffer) {
      return res.status(400).json({ success: false, error: 'Arquivo ou variável do certificado não encontrada.' });
    }

    const certificateValidation = validateCertificateForNationalApi(pfxBuffer, selectedCertificate.passphrase);
    if (!certificateValidation.valid) {
      return res.status(400).json({ success: false, error: certificateValidation.error });
    }

    const httpsAgent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: selectedCertificate.passphrase,
      rejectUnauthorized: false
    });

    const baseUrl = getNationalApiBaseUrl(requestEnvironment);

    const url = buildDfeUrl(baseUrl, 0, requestCnpjConsulta);

    const response = await axios.get(url, {
      httpsAgent,
      timeout: 15000,
      validateStatus: isNationalApiFiscalStatus,
      headers: { 'Accept': 'application/json', 'User-Agent': 'NFS-e Batch Downloader Local' }
    });

    const data = response.data;
    if (!data) return res.status(500).json({ success: false, error: 'Retorno vazio' });

    const nationalStatus = getNationalApiStatus(data);
    if (nationalStatus === 'REJEICAO') {
      const errorMsg = formatNationalApiRejection(data) || 'Rejeicao da API Nacional sem detalhes.';
      return res.status(400).json({
        success: false,
        error: errorMsg,
        nationalApi: buildNationalApiContext(response, url, requestEnvironment, requestCnpjConsulta)
      });
    }

    if (nationalStatus === 'NENHUM_DOCUMENTO_LOCALIZADO') {
      return res.json({
        success: true,
        maxNSU: 0,
        reliableMax: true,
        nationalApi: buildNationalApiContext(response, url, requestEnvironment, requestCnpjConsulta)
      });
    }

    let maxNSU = getResponseNsu(data, ['maxNSU', 'MaxNSU', 'maxNsu', 'maiorNSU', 'MaiorNSU', 'UltimoNSU', 'ultimoNSU']);
    let reliableMax = maxNSU !== null;
    
    // Se não encontrou de primeira, procura nos documentos
    if (maxNSU === null) {
      const documentsList = extractDfeDocuments(data);
      
      if (documentsList.length > 0) {
        maxNSU = Math.max(...documentsList.map(d => d.NSU || d.nsu || 0));
        if (documentsList.length === 50) maxNSU += 1;
      }
    }

    return res.json({ success: true, maxNSU: maxNSU || 0, reliableMax });
  } catch (e) {
    console.error('Erro no discover-nsu:', e);
    
    if (e.response) {
      if (e.response.status === 404) {
        return res.json({ success: true, maxNSU: 0 });
      }

      const nationalApiRejection = formatNationalApiRejection(e.response.data);
      if (nationalApiRejection) {
        return res.status(500).json({ success: false, error: nationalApiRejection });
      }
      
      const data = e.response.data;
      if (data && data.Erros && data.Erros.length > 0) {
        const errorDesc = data.Erros.map(err => `${err.Codigo}: ${err.Descricao}`).join(' | ');
        return res.status(500).json({ success: false, error: `Rejeição da API Nacional: ${errorDesc}` });
      }
    }

    return res.status(500).json({ success: false, error: 'Erro ao descobrir NSU: ' + e.message });
  }
});

app.get('/api/sync-state', async (req, res) => {
  const { certificateId, environment = 'producao', cnpjConsulta = '' } = req.query;
  const selectedCertificate = await resolveCertificateForRequest(certificateId);

  if (!selectedCertificate) {
    return res.status(400).json({ success: false, error: 'Certificado nÃ£o configurado ou nÃ£o encontrado.' });
  }

  await syncSupabaseCertificate(selectedCertificate, true);
  const state = await supabaseRpc('xml_nfse_get_sync_state', {
    p_certificate_id: selectedCertificate.id,
    p_environment: normalizeEnvironment(environment),
    p_cnpj_consulta: cnpjConsulta || ''
  });

  return res.json({
    success: Boolean(state),
    state
  });
});

// 6. Download individual sob demanda
app.get('/api/download-xml/:token', async (req, res) => {
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

// 7. Download de todos os XMLs consultados em um ZIP
app.get('/api/download-zip', async (req, res) => {
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
    for (const cached of payloads) {
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

// Iniciar Servidor
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`Servidor local da NFS-e rodando na porta ${PORT}`);
    console.log(`Acesse no navegador: http://localhost:${PORT}`);
    console.log(`Pasta de downloads XML: ${DOWNLOADS_DIR}`);
    console.log(`==================================================`);
  });
}

module.exports = app;
