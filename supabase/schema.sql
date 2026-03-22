-- ============================================================
-- FitAgenda — Schema Supabase (PostgreSQL)
-- Cole este script no SQL Editor do Supabase Dashboard
-- ============================================================

-- Habilita UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── PERSONALS (cada registro = 1 tenant) ───────────────────
CREATE TABLE IF NOT EXISTS personals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,
  telefone      TEXT,
  especialidade TEXT,
  plano         TEXT NOT NULL DEFAULT 'gratuito',
  ativo         BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ALUNOS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alunos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  personal_id   UUID NOT NULL REFERENCES personals(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  email         TEXT,
  telefone      TEXT,
  senha_hash    TEXT,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(personal_id, email)
);

-- ── CONVITES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS convites (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  personal_id   UUID NOT NULL REFERENCES personals(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  nome_aluno    TEXT,
  email_aluno   TEXT,
  usado         BOOLEAN NOT NULL DEFAULT false,
  aluno_id      UUID REFERENCES alunos(id),
  expires_at    DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── HORARIOS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS horarios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  personal_id   UUID NOT NULL REFERENCES personals(id) ON DELETE CASCADE,
  data          DATE NOT NULL,
  hora          TEXT NOT NULL,
  disponivel    BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(personal_id, data, hora)
);

-- ── AGENDAMENTOS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agendamentos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  personal_id   UUID NOT NULL REFERENCES personals(id) ON DELETE CASCADE,
  horario_id    UUID NOT NULL UNIQUE REFERENCES horarios(id) ON DELETE CASCADE,
  aluno_id      UUID REFERENCES alunos(id),
  nome          TEXT NOT NULL,
  telefone      TEXT NOT NULL,
  observacao    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AVALIACOES_FISICAS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS avaliacoes_fisicas (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  personal_id   UUID NOT NULL REFERENCES personals(id) ON DELETE CASCADE,
  aluno_id      UUID REFERENCES alunos(id),
  nome          TEXT NOT NULL,
  telefone      TEXT,
  data          DATE NOT NULL,
  peso          NUMERIC(5,1),
  altura        NUMERIC(5,1),
  gordura       NUMERIC(4,1),
  musculo       NUMERIC(4,1),
  imc           NUMERIC(4,1),
  obs           TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── INDEXES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_alunos_personal       ON alunos(personal_id);
CREATE INDEX IF NOT EXISTS idx_convites_token        ON convites(token);
CREATE INDEX IF NOT EXISTS idx_convites_personal     ON convites(personal_id);
CREATE INDEX IF NOT EXISTS idx_horarios_personal     ON horarios(personal_id);
CREATE INDEX IF NOT EXISTS idx_horarios_data         ON horarios(personal_id, data);
CREATE INDEX IF NOT EXISTS idx_agendamentos_personal ON agendamentos(personal_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_aluno    ON agendamentos(aluno_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_personal   ON avaliacoes_fisicas(personal_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_aluno      ON avaliacoes_fisicas(aluno_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_nome       ON avaliacoes_fisicas(personal_id, nome);

-- ── ROW LEVEL SECURITY (opcional mas recomendado) ──────────
-- Se quiser usar RLS, habilite por tabela e crie policies
-- Por agora desabilitado — filtragem feita na aplicação
ALTER TABLE personals        DISABLE ROW LEVEL SECURITY;
ALTER TABLE alunos           DISABLE ROW LEVEL SECURITY;
ALTER TABLE convites         DISABLE ROW LEVEL SECURITY;
ALTER TABLE horarios         DISABLE ROW LEVEL SECURITY;
ALTER TABLE agendamentos     DISABLE ROW LEVEL SECURITY;
ALTER TABLE avaliacoes_fisicas DISABLE ROW LEVEL SECURITY;
