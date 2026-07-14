/**
 * Rate limit simples em memoria (por IP + rota).
 * Suficiente para um unico processo Node/Vercel warm.
 */

function createRateLimiter({ windowMs = 60000, max = 30, keyPrefix = 'rl' } = {}) {
  const hits = new Map();

  function prune(now) {
    for (const [key, entry] of hits.entries()) {
      if (now - entry.start >= windowMs) hits.delete(key);
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    if (hits.size > 5000) prune(now);

    // req.ip honors Express' bounded trust-proxy setting; never trust a raw
    // X-Forwarded-For supplied directly by the client.
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const key = `${keyPrefix}:${ip}:${req.path}`;
    let entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      const retryAfter = Math.ceil((windowMs - (now - entry.start)) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
      return res.status(429).json({
        success: false,
        error: 'Muitas requisicoes. Aguarde alguns segundos e tente novamente.',
        retryable: true
      });
    }

    return next();
  };
}

module.exports = {
  createRateLimiter
};
