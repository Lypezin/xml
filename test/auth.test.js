const test = require('node:test');
const assert = require('node:assert/strict');

const { isUserAllowed } = require('../src/config/auth');

test('every authenticated Supabase user is accepted without extra access configuration', () => {
  assert.equal(isUserAllowed({ email: 'usuario@qualquer-dominio.com' }), true);
  assert.equal(isUserAllowed('outro@site.com'), true);
  assert.equal(isUserAllowed({}), false);
});
