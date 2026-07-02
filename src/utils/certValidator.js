const forge = require('node-forge');
const { getCertificateDisplayName, extractCertificateCnpj } = require('./cert');

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

module.exports = {
  getBagLocalKeyId,
  selectLeafCertificateBag,
  validateCertificateForNationalApi
};
