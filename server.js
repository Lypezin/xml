const express = require('express');
const fs = require('fs');
const path = require('path');

const {
  IS_VERCEL,
  CONFIG_DIR,
  DOWNLOADS_DIR,
  CERTS_DIR
} = require('./src/config/constants');
const {
  basicAuthMiddleware,
  requireSupabaseAuth,
  isSupabaseAuthRequired
} = require('./src/config/auth');
const { getSupabaseConfig } = require('./src/services/supabase');
const { createRateLimiter } = require('./src/middleware/rateLimit');

const app = express();
const PORT = process.env.PORT || 3000;

// Garantir que as pastas existem
if (!IS_VERCEL) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });
}

// Middlewares
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// Headers de segurança basicos (sem CSP estrito para nao quebrar assets/inline legados)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (IS_VERCEL || req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// Rota de configuração pública do Supabase
app.get('/api/auth-config', (req, res) => {
  const config = getSupabaseConfig();
  return res.json({
    authRequired: isSupabaseAuthRequired(),
    supabaseUrl: config ? config.url : null,
    publishableKey: config ? config.key : null
  });
});

// Middleware de Autenticação Básica (opcional localmente)
app.use(basicAuthMiddleware);

// Middleware de Autenticação do Supabase (para rotas /api)
app.use('/api', requireSupabaseAuth);

// Rate limits por grupo de rotas (apos auth, por IP)
const rlGeneral = createRateLimiter({ windowMs: 60_000, max: 120, keyPrefix: 'api' });
const rlHeavy = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'heavy' });
const rlUpload = createRateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'upload' });

app.use('/api', rlGeneral);
app.use('/api/fetch-batch', rlHeavy);
app.use('/api/discover-nsu', rlHeavy);
app.use('/api/scan-cancellations', rlHeavy);
app.use('/api/download-period-zip', rlHeavy);
app.use('/api/download-excel', rlHeavy);
app.use('/api/upload-certificate', rlUpload);

// Importar e associar Rotas do Sistema
app.use('/api', require('./src/routes/certificatesList'));
app.use('/api', require('./src/routes/certificatesDiagnostics'));
app.use('/api', require('./src/routes/certificatesManage'));
app.use('/api', require('./src/routes/sync'));
app.use('/api', require('./src/routes/downloads'));
app.use('/api', require('./src/routes/units'));
app.use('/api', require('./src/routes/schedulerRoutes'));
app.use('/api', require('./src/routes/insights'));

// Estáticos: JS/HTML sem cache longo (auth/boot mudam e cache velho gera 401/403)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.js$/i.test(filePath) || /sw\.js$/i.test(filePath)) {
      // JS de auth/boot: sempre revalidar
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (/\.(css|svg|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=3600');
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));
if (!IS_VERCEL) {
  app.use('/downloads', express.static(DOWNLOADS_DIR));
}

// Iniciar Servidor (somente se executado diretamente, não em serverless Vercel)
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`==================================================`);
    console.log(`Servidor local da NFS-e rodando na porta ${PORT}`);
    console.log(`Acesse no navegador: http://localhost:${PORT}`);
    console.log(`Pasta de downloads XML: ${DOWNLOADS_DIR}`);
    console.log(`==================================================`);

    // Atualizacoes de NSU ficam manuais para evitar chamadas automaticas ao barramento.
  });
}

module.exports = app;
