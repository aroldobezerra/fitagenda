require('dotenv').config();

const ENV_REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
const missing = ENV_REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error('\n❌ Variáveis faltando no .env:', missing.join(', '));
  process.exit(1);
}

const express = require('express');
const { alunosRouter, avalRouter } = require('./routes/alunos-aval');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS — deve ser o PRIMEIRO middleware ─────────────────
// Responde OPTIONS imediatamente antes de qualquer outra coisa
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age',       '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(express.json());

if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${req.method} ${req.path}`);
    next();
  });
}

// ── Rotas ─────────────────────────────────────────────────
app.use('/auth',       require('./routes/auth'));
app.use('/admin',      require('./routes/admin'));
app.use('/horarios',   require('./routes/horarios'));
app.use('/planos',     require('./routes/planos'));
app.use('/',           require('./routes/agendamentos'));
app.use('/alunos',     alunosRouter);
app.use('/avaliacao',  avalRouter);
app.use('/avaliacoes', avalRouter);

app.get('/', (_req, res) => res.json({
  api: 'FitAgenda v3', status: 'online', db: 'Supabase',
  env: {
    SUPABASE_URL:         process.env.SUPABASE_URL         ? '✓' : '✗',
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? '✓' : '✗',
    JWT_SECRET:           process.env.JWT_SECRET           ? '✓' : '✗',
  }
}));

app.use((_req, res) => res.status(404).json({ erro: 'Endpoint não encontrado.' }));
app.use((err, _req, res, _next) => {
  console.error('Erro interno:', err.message);
  res.status(500).json({ erro: err.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🏋️  FitAgenda API → http://localhost:${PORT}\n`);
  });
}

module.exports = app;
