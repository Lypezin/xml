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

const app = express();
const PORT = process.env.PORT || 3000;

// Garantir que as pastas existem
if (!IS_VERCEL) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });
}

// Middlewares
app.use(express.json());

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

// Importar e associar Rotas do Sistema
app.use('/api', require('./src/routes/certificatesList'));
app.use('/api', require('./src/routes/certificatesDiagnostics'));
app.use('/api', require('./src/routes/certificatesManage'));
app.use('/api', require('./src/routes/sync'));
app.use('/api', require('./src/routes/downloads'));
app.use('/api', require('./src/routes/units'));
app.use('/api', require('./src/routes/schedulerRoutes'));

// Servir arquivos estáticos com cache longo (acelera recarregar guias/CSS/JS)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_VERCEL ? '1h' : '15m',
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.(css|js|svg|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=3600');
    }
    if (/\.html$/i.test(filePath)) {
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
