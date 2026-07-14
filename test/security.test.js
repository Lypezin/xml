const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeFileName,
  resolveContainedPath,
  rejectUnauthorizedForNfse,
  safeErrorInfo
} = require('../src/utils/security');
const { getCertificateEncryptionKey, encryptCertificateValue, decryptCertificateValue } = require('../src/utils/crypto');

test('sanitizeFileName removes path traversal and invalid characters', () => {
  assert.equal(sanitizeFileName('../../EVENTO:123.xml'), 'EVENTO_123.xml');
  assert.equal(sanitizeFileName('..\\..\\nota.xml'), 'nota.xml');
  assert.equal(sanitizeFileName(''), 'documento.xml');
});

test('resolveContainedPath always remains inside the base directory', () => {
  const result = resolveContainedPath('C:\\safe\\downloads', '../../nota.xml');
  assert.match(result, /safe[\\/]downloads[\\/]nota\.xml$/i);
});

test('NFS-e TLS verification is always enabled', () => {
  assert.equal(rejectUnauthorizedForNfse(), true);
  process.env.NFSE_TLS_REJECT_UNAUTHORIZED = 'false';
  assert.equal(rejectUnauthorizedForNfse(), true);
  delete process.env.NFSE_TLS_REJECT_UNAUTHORIZED;
});

test('safeErrorInfo does not include Axios config or secrets', () => {
  const result = safeErrorInfo({
    name: 'AxiosError',
    message: 'request failed',
    code: 'ERR_BAD_RESPONSE',
    response: { status: 500 },
    config: { p_secret: 'hidden', httpsAgent: { options: { passphrase: 'hidden' } } }
  });
  assert.deepEqual(result, {
    name: 'AxiosError',
    message: 'request failed',
    code: 'ERR_BAD_RESPONSE',
    status: 500
  });
  assert.equal(JSON.stringify(result).includes('hidden'), false);
});

test('certificate values round-trip with AES-256-GCM', () => {
  const before = process.env.CERT_ENCRYPTION_KEY;
  process.env.CERT_ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    const encrypted = encryptCertificateValue(Buffer.from('pfx-secret'));
    assert.notEqual(encrypted.ciphertext, Buffer.from('pfx-secret').toString('base64'));
    assert.equal(decryptCertificateValue(encrypted).toString('utf8'), 'pfx-secret');
  } finally {
    if (before === undefined) delete process.env.CERT_ENCRYPTION_KEY;
    else process.env.CERT_ENCRYPTION_KEY = before;
  }
});

test('certificate key is derived automatically from the existing app secret', () => {
  const beforeKey = process.env.CERT_ENCRYPTION_KEY;
  const beforeSecret = process.env.SUPABASE_APP_SECRET;
  delete process.env.CERT_ENCRYPTION_KEY;
  process.env.SUPABASE_APP_SECRET = 'existing-strong-application-secret';
  try {
    const first = getCertificateEncryptionKey();
    const second = getCertificateEncryptionKey();
    assert.equal(first.length, 32);
    assert.deepEqual(first, second);
  } finally {
    if (beforeKey === undefined) delete process.env.CERT_ENCRYPTION_KEY;
    else process.env.CERT_ENCRYPTION_KEY = beforeKey;
    if (beforeSecret === undefined) delete process.env.SUPABASE_APP_SECRET;
    else process.env.SUPABASE_APP_SECRET = beforeSecret;
  }
});
