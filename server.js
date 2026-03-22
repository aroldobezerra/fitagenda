require('dotenv').config();

const ENV_REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
const missing = ENV_REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error('\n❌ Variáveis faltando no .env:', missing.join(', '));
  process.exit(1);
}

const express = require('express');
const cors    = require('cors');
const { alunosRouter, avalRouter } = require('./routes/alunos-aval');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json());

app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${req.method} ${req.path}`);
  }
  next();
});

// ── Rotas ────────────────────────────────────────────────
app.use('/auth',       require('./routes/auth'));
app.use('/horarios',   require('./routes/horarios'));
app.use('/planos',     require('./routes/planos'));

// Agendamentos: montado na raiz — rotas internas definem os caminhos completos
app.use('/',           require('./routes/agendamentos'));

app.use('/alunos',     alunosRouter);
app.use('/avaliacao',  avalRouter);
app.use('/avaliacoes', avalRouter);

app.get('/', (_req, res) => res.json({
  api: 'FitAgenda v3', status: 'online', db: 'Supabase',
  env: {
    SUPABASE_URL:         process.env.SUPABASE_URL        ? '✓' : '✗',
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? '✓' : '✗',
    JWT_SECRET:           process.env.JWT_SECRET           ? '✓' : '✗',
  }
}));

app.use((_req, res) => res.status(404).json({ erro: 'Endpoint não encontrado.' }));
app.use((err, _req, res, _next) => {
  console.error('Erro interno:', err.message);
  res.status(500).json({
    erro: err.message,
    ...(process.env.NODE_ENV !== 'production' && { detalhe: err.stack?.split('\n')[0] })
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🏋️  FitAgenda API → http://localhost:${PORT}`);
    console.log(`   Supabase: ${process.env.SUPABASE_URL}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}\n`);
  });
}

module.exports = app;
