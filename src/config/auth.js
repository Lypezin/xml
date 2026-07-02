const { IS_VERCEL } = require('./constants');
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

function isUserAllowed(email) {
  const normalizedEmail = String(email || '').toLowerCase();
  if (!normalizedEmail) return false;

  const allowedEmails = getAllowedEmails();
  const allowedDomains = getAllowedDomains();

  if (allowedEmails.length === 0 && allowedDomains.length === 0) {
    return true;
  }

  if (allowedEmails.includes(normalizedEmail)) {
    return true;
  }

  return allowedDomains.some(domain => normalizedEmail.endsWith(`@${domain}`));
}

function basicAuthMiddleware(req, res, next) {
  if (!isAccessAuthEnabled()) {
    return next();
  }

  const header = req.headers.authorization || '';
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
    if (!user || !isUserAllowed(user.email)) {
      return res.status(403).json({ success: false, error: 'Usuário não autorizado para este sistema.' });
    }

    req.authUser = {
      id: user.id,
      email: user.email
    };
    return next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
  }
}

module.exports = {
  isAccessAuthEnabled,
  isSupabaseAuthRequired,
  getAllowedEmails,
  getAllowedDomains,
  isUserAllowed,
  basicAuthMiddleware,
  requireSupabaseAuth
};
