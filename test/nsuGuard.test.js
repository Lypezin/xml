const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeNsu, protectAscendingStartNsu } = require('../src/utils/nsuGuard');

test('normalizeNsu converts invalid and negative values to zero', () => {
  assert.equal(normalizeNsu('42'), 42);
  assert.equal(normalizeNsu(-5), 0);
  assert.equal(normalizeNsu('invalid'), 0);
});

test('ascending sync resumes saved NSU instead of accidentally returning to zero', () => {
  assert.deepEqual(
    protectAscendingStartNsu({ requestedStartNsu: 0, savedLastNsu: 162381, sortOrder: 'asc' }),
    { startNsu: 162381, adjusted: true, requestedStartNsu: 0 }
  );
});

test('explicit reset and reverse searches remain allowed', () => {
  assert.equal(
    protectAscendingStartNsu({ requestedStartNsu: 0, savedLastNsu: 0, sortOrder: 'asc' }).adjusted,
    false
  );
  assert.equal(
    protectAscendingStartNsu({ requestedStartNsu: 0, savedLastNsu: 162381, sortOrder: 'desc' }).adjusted,
    false
  );
});
