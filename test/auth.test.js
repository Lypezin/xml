const test = require('node:test');
const assert = require('node:assert/strict');

const { isUserAllowed, getXmlNfseRole, requireXmlRole, isSchedulerCronRequest } = require('../src/config/auth');

function withAuthEnv(values, fn) {
  const keys = ['AUTH_ALLOWED_EMAILS', 'AUTH_ALLOWED_DOMAINS', 'AUTH_ALLOW_ALL_SUPABASE_USERS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => delete process.env[key]);
  Object.entries(values).forEach(([key, value]) => { process.env[key] = value; });
  try { fn(); } finally {
    keys.forEach(key => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test('shared Supabase access fails closed when no policy is configured', () => {
  withAuthEnv({}, () => assert.equal(isUserAllowed({ email: 'user@other-site.com' }), false));
});

test('allowlists and XML role claims grant access', () => {
  withAuthEnv({ AUTH_ALLOWED_DOMAINS: 'empresa.com.br' }, () => {
    assert.equal(isUserAllowed({ email: 'ana@empresa.com.br' }), true);
    assert.equal(isUserAllowed({ email: 'ana@other-site.com' }), false);
  });
  withAuthEnv({}, () => {
    const user = { email: 'operator@other-site.com', app_metadata: { xml_nfse_role: 'operator' } };
    assert.equal(getXmlNfseRole(user), 'operator');
    assert.equal(isUserAllowed(user), true);
  });
});

test('RBAC rejects a viewer and allows an operator', () => {
  const before = process.env.AUTH_REQUIRED;
  process.env.AUTH_REQUIRED = 'true';
  try {
    const middleware = requireXmlRole('admin', 'operator');
    let nextCalled = false;
    middleware({ authUser: { role: 'operator' } }, {}, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    let responseStatus = 0;
    let responseBody = null;
    middleware(
      { authUser: { role: 'viewer' } },
      {
        status(code) { responseStatus = code; return this; },
        json(body) { responseBody = body; return this; }
      },
      () => assert.fail('viewer must not pass')
    );
    assert.equal(responseStatus, 403);
    assert.equal(responseBody.code, 'ROLE_NOT_ALLOWED');
  } finally {
    if (before === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = before;
  }
});

test('scheduler cron accepts only a Bearer secret and never a query-string secret', () => {
  const before = process.env.SCHEDULER_SECRET;
  process.env.SCHEDULER_SECRET = 'cron-secret';
  try {
    assert.equal(isSchedulerCronRequest({
      path: '/scheduler-cron',
      headers: { authorization: 'Bearer cron-secret' },
      query: {}
    }), true);
    assert.equal(isSchedulerCronRequest({
      path: '/scheduler-cron',
      headers: {},
      query: { secret: 'cron-secret' }
    }), false);
  } finally {
    if (before === undefined) delete process.env.SCHEDULER_SECRET;
    else process.env.SCHEDULER_SECRET = before;
  }
});
