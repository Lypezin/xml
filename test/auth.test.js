const test = require('node:test');
const assert = require('node:assert/strict');

const { isUserAllowed, isSchedulerCronRequest } = require('../src/config/auth');

test('every authenticated Supabase user is accepted without extra access configuration', () => {
  assert.equal(isUserAllowed({ email: 'usuario@qualquer-dominio.com' }), true);
  assert.equal(isUserAllowed('outro@site.com'), true);
  assert.equal(isUserAllowed({}), false);
});

test('daily cron accepts only the configured bearer token', () => {
  const before = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'daily-secret';
  try {
    assert.equal(isSchedulerCronRequest({
      path: '/scheduler-cron/1',
      headers: { authorization: 'Bearer daily-secret' }
    }), true);
    assert.equal(isSchedulerCronRequest({
      path: '/scheduler-cron/1',
      headers: { authorization: 'Bearer wrong-secret' }
    }), false);
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
});
