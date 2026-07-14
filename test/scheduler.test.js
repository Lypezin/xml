const test = require('node:test');
const assert = require('node:assert/strict');
const { partitionCertificates } = require('../src/services/scheduler');

test('daily scheduler partitions every certificate once across seven shards', () => {
  const certificates = Array.from({ length: 7 }, (_, index) => ({ id: `cert-${index + 1}` }));
  const shards = Array.from({ length: 7 }, (_, shard) => partitionCertificates(certificates, shard, 7));
  assert.deepEqual(shards.map(items => items.length), Array(7).fill(1));
  const ids = shards.flat().map(item => item.id);
  assert.equal(new Set(ids).size, 7);
  assert.deepEqual([...ids].sort(), certificates.map(item => item.id).sort());
});
