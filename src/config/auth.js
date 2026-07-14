const { IS_VERCEL } = require('./constants');
const { getSupabaseUserFromToken } = require('../services/supabase');

function isAccessAuthEnabled() {
  return Boolean(process.env.APP_ACCESS_USER && process.env.APP_ACCESS_PASSWORD);
}

function isSupabaseAuthRequired() {
  return process.env.AUTH_REQUIRED === 'true' || IS_VERCEL;
}

function isUserAllowed(userOrEmail) {
  const user = typeof userOrEmail === 'object' && userOrEmail !== null ? userOrEmail : null;
  const email = user ? user.email : (typeof userOrEmail === 'string' ? userOrEmail : '');
  return Boolean(String(email || '').trim());
}

function basicAuthMiddleware(req, res, next) {
  if (!isAccessAuthEnabled()) return next();

  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ') && isSupabaseAuthRequired()) return next();

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
  if (req.path === '/auth-config' || !isSupabaseAuthRequired()) return next();

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

    req.authUser = { id: user.id, email: user.email };
    return next();
  } catch (error) {
    console.warn('[requireSupabaseAuth]', error.message);
    return res.status(401).json({
      success: false,
      error: 'Sessão inválida ou expirada. Faça login novamente.',
      code: 'SESSION_ERROR'
    });
  }
}

module.exports = {
  isAccessAuthEnabled,
  isSupabaseAuthRequired,
  isUserAllowed,
  basicAuthMiddleware,
  requireSupabaseAuth
};
