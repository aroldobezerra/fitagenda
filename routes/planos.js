const express = require('express');
const db = require('../lib/supabase');
const { authMiddleware, soPersonal } = require('../middleware/auth');

const router = express.Router();

// ── URLs de checkout Cakto (um produto por plano) ─────────
const CAKTO_STARTER_URL = 'https://pay.cakto.com.br/r6kjmgx'; 
const CAKTO_PRO_URL     = 'https://pay.cakto.com.br/359ukpd_814619';

// ── Limites por plano ─────────────────────────────────────
const LIMITES = {
  gratuito: { max_alunos: 5,        dias_agenda: 7,  avaliacoes: false, label: 'Gratuito' },
  starter:  { max_alunos: 15,       dias_agenda: 30, avaliacoes: true,  label: 'Starter'  },
  pro:      { max_alunos: Infinity, dias_agenda: 60, avaliacoes: true,  label: 'Pro'      },
};

const PRECOS = { starter: 24.90, pro: 49.90 };

// ── GET /planos/meu ───────────────────────────────────────
router.get('/meu', authMiddleware, soPersonal, async (req, res) => {
  try {
    const { data: p } = await db
      .from('personals')
      .select('plano,plano_status,plano_expira,trial_expira')
      .eq('id', req.user.personal_id)
      .maybeSingle();

    const plano  = p?.plano || 'gratuito';
    const agora  = new Date().toISOString().split('T')[0];

    // Rebaixa automático se expirou (starter ou pro)
    if ((plano === 'pro' || plano === 'starter') && p?.plano_expira && p.plano_expira < agora) {
      await db.from('personals')
        .update({ plano: 'gratuito', plano_status: 'ativo' })
        .eq('id', req.user.personal_id);
      return res.json({
        plano: 'gratuito', status: 'expirado',
        expira_em: null,
        limites: LIMITES.gratuito,
        checkout_starter: CAKTO_STARTER_URL,
        checkout_pro:     CAKTO_PRO_URL,
        precos: PRECOS,
      });
    }

    res.json({
      plano,
      status:           p?.plano_status || 'ativo',
      expira_em:        p?.plano_expira  || null,
      trial_expira:     p?.trial_expira  || null,
      limites:          LIMITES[plano] || LIMITES.gratuito,
      checkout_starter: CAKTO_STARTER_URL,
      checkout_pro:     CAKTO_PRO_URL,
      precos:           PRECOS,
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── GET /planos/lista ─────────────────────────────────────
router.get('/lista', (_req, res) => {
  res.json({
    planos: [
      {
        id: 'gratuito', nome: 'Gratuito', preco: 0, periodo: 'para sempre',
        features: ['Até 5 alunos', '7 dias de agenda', 'Agendamentos ilimitados', 'Convites'],
        limitado: true,
      },
      {
        id: 'starter', nome: 'Starter', preco: PRECOS.starter, periodo: 'por mês',
        features: ['Até 15 alunos', '30 dias de agenda', 'Avaliações físicas', 'Convites ilimitados'],
        limitado: false, destaque: false,
        checkout_url: CAKTO_STARTER_URL,
      },
      {
        id: 'pro', nome: 'Pro', preco: PRECOS.pro, periodo: 'por mês',
        features: ['Alunos ilimitados', '60 dias de agenda', 'Avaliações físicas', 'Histórico de evolução', 'Suporte prioritário'],
        limitado: false, destaque: true,
        checkout_url: CAKTO_PRO_URL,
      },
    ]
  });
});

// ── POST /planos/assinar ──────────────────────────────────
router.post('/assinar', authMiddleware, soPersonal, async (req, res) => {
  try {
    const { tipo = 'pro' } = req.body; // 'starter' ou 'pro'
    const pid = req.user.personal_id;

    if (!['starter', 'pro'].includes(tipo))
      return res.status(400).json({ erro: 'Tipo de plano inválido.' });

    await db.from('assinaturas').insert({
      personal_id: pid,
      plano:       tipo,
      status:      'pendente',
      valor:       PRECOS[tipo],
    });

    res.json({
      checkout_url: tipo === 'starter' ? CAKTO_STARTER_URL : CAKTO_PRO_URL,
      mensagem: 'Redirecione o usuário para o checkout.',
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── POST /planos/webhook — Cakto ──────────────────────────
router.post('/webhook', async (req, res) => {
  try {
    const body    = req.body;
    console.log('Webhook Cakto recebido:', JSON.stringify(body, null, 2));

    const status   = body?.status || body?.payment_status;
    const email    = body?.customer?.email || body?.email;
    const valor    = Number(body?.amount || body?.value || 0);
    const aprovado = ['paid', 'approved', 'complete', 'completed'].includes(
      String(status).toLowerCase()
    );

    if (aprovado && email) {
      const { data: personal } = await db
        .from('personals').select('id')
        .eq('email', email.toLowerCase()).maybeSingle();

      if (personal) {
        // Determina plano pelo valor pago
        const tipoPlano = valor <= 25 ? 'starter' : 'pro';

        const periodoFim = new Date();
        periodoFim.setMonth(periodoFim.getMonth() + 1);
        const periodoFimStr = periodoFim.toISOString().split('T')[0];

        await db.from('personals').update({
          plano:        tipoPlano,
          plano_status: 'ativo',
          plano_expira: periodoFimStr,
        }).eq('id', personal.id);

        await db.from('assinaturas')
          .update({
            status:         'aprovado',
            mp_payment_id:  String(body?.order_id || body?.id || Date.now()),
            mp_status:      String(status),
            periodo_inicio: new Date().toISOString().split('T')[0],
            periodo_fim:    periodoFimStr,
          })
          .eq('personal_id', personal.id)
          .eq('status', 'pendente');

        console.log(`✅ Plano ${tipoPlano} ativado para: ${email} até ${periodoFimStr}`);
      } else {
        console.warn(`⚠️ Personal não encontrado: ${email}`);
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook erro:', e.message);
    res.sendStatus(200);
  }
});

// ── POST /planos/ativar-manual [dev only] ─────────────────
router.post('/ativar-manual', authMiddleware, soPersonal, async (req, res) => {
  if (process.env.NODE_ENV === 'production')
    return res.status(403).json({ erro: 'Não disponível em produção.' });

  try {
    const { tipo = 'pro' } = req.body;
    const pid = req.user.personal_id;

    if (!['starter', 'pro'].includes(tipo))
      return res.status(400).json({ erro: 'Tipo inválido.' });

    const periodoFim = new Date();
    periodoFim.setMonth(periodoFim.getMonth() + 1);
    const periodoFimStr = periodoFim.toISOString().split('T')[0];

    await db.from('personals').update({
      plano:        tipo,
      plano_status: 'ativo',
      plano_expira: periodoFimStr,
    }).eq('id', pid);

    await db.from('assinaturas').insert({
      personal_id:   pid,
      plano:         tipo,
      status:        'aprovado',
      mp_payment_id: `dev_${Date.now()}`,
      mp_status:     'approved',
      valor:         PRECOS[tipo],
      periodo_inicio: new Date().toISOString().split('T')[0],
      periodo_fim:    periodoFimStr,
    });

    res.json({ mensagem: `Plano ${tipo} ativado (dev).`, expira_em: periodoFimStr });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
module.exports.LIMITES = LIMITES;
