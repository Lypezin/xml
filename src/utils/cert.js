const fs = require('fs');
const forge = require('node-forge');

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

module.exports = {
  getEnvCertificate,
  getCertificateBuffer,
  getCertificateDisplayName,
  extractCnpjFromText,
  extractCnpjFromAsn1Value,
  extractCertificateCnpj,
  onlyDigits,
  validateCnpjConsultaRoot
};
