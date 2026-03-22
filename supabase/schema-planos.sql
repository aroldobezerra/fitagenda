-- ============================================================
-- Adiciona suporte a planos e pagamentos
-- Execute no SQL Editor do Supabase APÓS o schema.sql inicial
-- ============================================================

-- Adiciona colunas de plano na tabela personals
ALTER TABLE personals
  ADD COLUMN IF NOT EXISTS plano          TEXT    NOT NULL DEFAULT 'gratuito',
  ADD COLUMN IF NOT EXISTS plano_status   TEXT    NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS plano_expira   DATE,
  ADD COLUMN IF NOT EXISTS trial_expira   DATE    DEFAULT (CURRENT_DATE + INTERVAL '14 days');

-- Tabela de assinaturas / pagamentos
CREATE TABLE IF NOT EXISTS assinaturas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  personal_id     UUID NOT NULL REFERENCES personals(id) ON DELETE CASCADE,
  plano           TEXT NOT NULL DEFAULT 'pro',
  status          TEXT NOT NULL DEFAULT 'pendente',
  -- MercadoPago
  mp_preference_id TEXT,
  mp_payment_id    TEXT,
  mp_status        TEXT,
  -- Valores
  valor           NUMERIC(8,2) NOT NULL DEFAULT 49.90,
  moeda           TEXT NOT NULL DEFAULT 'BRL',
  -- Período
  periodo_inicio  DATE,
  periodo_fim     DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assinaturas_personal ON assinaturas(personal_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_mp       ON assinaturas(mp_payment_id);

-- Limites por plano (referência)
-- gratuito: 5 alunos, 7 dias agenda, sem avaliações
-- pro:      ilimitado, tudo liberado
