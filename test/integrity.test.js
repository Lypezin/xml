const test = require('node:test');
const assert = require('node:assert/strict');
const { csvCell, documentManifestRow } = require('../src/routes/downloadsIntegrity');

test('manifest CSV escapes formulas, separators and quotes', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('Empresa; Fiscal'), '"Empresa; Fiscal"');
});

test('manifest includes the persisted XML SHA-256 and custody timestamps', () => {
  const row = documentManifestRow({
    nsu: 42,
    chave: '123',
    xml_sha256: 'abc123',
    first_seen_at: '2026-07-01T10:00:00Z',
    last_seen_at: '2026-07-02T10:00:00Z',
    metadata: {}
  });
  assert.equal(row[0], 42);
  assert.equal(row[10], 'abc123');
  assert.equal(row[11], '2026-07-01T10:00:00Z');
  assert.equal(row[12], '2026-07-02T10:00:00Z');
});
