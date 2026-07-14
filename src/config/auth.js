const { IS_VERCEL } = require('./constants');
const crypto = require('crypto');
const { getSupabaseUserFromToken, getSupabaseConfig } = require('../services/supabase');

function isAccessAuthEnabled() {
  return Boolean(process.env.APP_ACCESS_USER && process.env.APP_ACCESS_PASSWORD);
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

function getXmlNfseRole(user) {
  const role = String(
    user?.app_metadata?.xml_nfse_role ||
    user?.user_metadata?.xml_nfse_role ||
    ''
  ).trim().toLowerCase();
  return ['admin', 'operator', 'viewer'].includes(role) ? role : null;
}

function isAccessPolicyConfigured() {
  return getAllowedEmails().length > 0 ||
    getAllowedDomains().length > 0 ||
    process.env.AUTH_ALLOW_ALL_SUPABASE_USERS === 'true' ||
    process.env.AUTH_REQUIRE_XML_NFSE_ROLE === 'true';
}

function isUserAllowed(userOrEmail) {
  const user = typeof userOrEmail === 'object' && userOrEmail !== null ? userOrEmail : null;
  const normalizedEmail = String(user?.email || userOrEmail || '').toLowerCase();
  if (!normalizedEmail) return false;

  if (getXmlNfseRole(user)) return true;

  const allowedEmails = getAllowedEmails();
  const allowedDomains = getAllowedDomains();

  if (allowedEmails.length === 0 && allowedDomains.length === 0) {
    // Shared Supabase project: never trust every authenticated user by default.
    return process.env.AUTH_ALLOW_ALL_SUPABASE_USERS === 'true';
  }

  if (allowedEmails.includes(normalizedEmail)) {
    return true;
  }

  return allowedDomains.some(domain => normalizedEmail.endsWith(`@${domain}`));
}

function isSchedulerCronRequest(req) {
  if (req.path !== '/scheduler-cron') return false;

  const secret = process.env.SCHEDULER_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) return false;

  const expected = Buffer.from(secret);
  const received = Buffer.from(token);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function basicAuthMiddleware(req, res, next) {
  if (!isAccessAuthEnabled()) {
    return next();
  }

  const header = req.headers.authorization || '';
  // Não conflitar com JWT do Supabase (Bearer) — o requireSupabaseAuth valida o token
  if (header.startsWith('Bearer ') && isSupabaseAuthRequired()) {
    return next();
  }

  const [type, encoded] = header.split(' ');
  if (type === 'Basic' && encoded) {
    const [user, password] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (user === process.env.APP_ACCESS_USER && password === process.env.APP_ACCESS_PASSWORD) {
      return next();
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="XML NFS-e"');
  return res.status(401).send('Autenticação obrigatória.');
}

async function requireSupabaseAuth(req, res, next) {
  if (isSchedulerCronRequest(req)) {
    req.authUser = {
      id: 'scheduler-cron',
      email: 'scheduler-cron',
      role: 'admin'
    };
    return next();
  }

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
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Sessão inválida ou expirada. Faça login novamente.',
        code: 'SESSION_INVALID'
      });
    }

    if (!isUserAllowed(user)) {
      return res.status(403).json({
        success: false,
        error: 'Usuário não autorizado para este sistema. Peça inclusão em AUTH_ALLOWED_EMAILS/DOMAINS.',
        code: 'USER_NOT_ALLOWED'
      });
    }

    req.authUser = {
      id: user.id,
      email: user.email,
      // Explicit claims can restrict access. Existing allowlists retain admin behavior.
      role: getXmlNfseRole(user) || 'admin'
    };
    return next();
  } catch (e) {
    console.warn('[requireSupabaseAuth]', e.message);
    return res.status(401).json({
      success: false,
      error: 'Sessão inválida ou expirada. Faça login novamente.',
      code: 'SESSION_ERROR'
    });
  }
}

function requireXmlRole(...allowedRoles) {
  const allowed = new Set(allowedRoles);
  return (req, res, next) => {
    if (!isSupabaseAuthRequired()) return next();
    const role = req.authUser?.role || 'viewer';
    if (allowed.has(role)) return next();
    return res.status(403).json({
      success: false,
      error: 'Seu perfil não tem permissão para esta operação.',
      code: 'ROLE_NOT_ALLOWED'
    });
  };
}

module.exports = {
  isAccessAuthEnabled,
  isSupabaseAuthRequired,
  getAllowedEmails,
  getAllowedDomains,
  getXmlNfseRole,
  isAccessPolicyConfigured,
  isUserAllowed,
  isSchedulerCronRequest,
  basicAuthMiddleware,
  requireSupabaseAuth,
  requireXmlRole
};
