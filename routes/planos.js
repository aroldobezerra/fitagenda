const express = require('express');
const db = require('../lib/supabase');
const { authMiddleware, soPersonal } = require('../middleware/auth');

const router = express.Router();

const CAKTO_URL = 'https://pay.cakto.com.br/359ukpd_814619';

const LIMITES = {
  gratuito: { max_alunos: 5,        dias_agenda: 7,  avaliacoes: false, label: 'Gratuito' },
  pro:      { max_alunos: Infinity, dias_agenda: 60, avaliacoes: true,  label: 'Pro'      }
};

const PRECO_PRO_BRL = 49.90;

// GET /planos/meu
router.get('/meu', authMiddleware, soPersonal, async (req, res) => {
  try {
    const { data: p } = await db
      .from('personals')
      .select('plano,plano_status,plano_expira,trial_expira')
      .eq('id', req.user.personal_id)
      .maybeSingle();

    const plano   = p?.plano || 'gratuito';
    const limites = LIMITES[plano] || LIMITES.gratuito;
    const agora   = new Date().toISOString().split('T')[0];

    // Rebaixa automático se expirou
    if (plano === 'pro' && p?.plano_expira && p.plano_expira < agora) {
      await db.from('personals')
        .update({ plano: 'gratuito', plano_status: 'ativo' })
        .eq('id', req.user.personal_id);
      return res.json({
        plano: 'gratuito', status: 'expirado',
        expira_em: null, limites: LIMITES.gratuito,
        preco_pro: PRECO_PRO_BRL, checkout_url: CAKTO_URL
      });
    }

    res.json({
      plano,
      status:       p?.plano_status || 'ativo',
      expira_em:    p?.plano_expira  || null,
      trial_expira: p?.trial_expira  || null,
      limites,
      preco_pro:    PRECO_PRO_BRL,
      checkout_url: CAKTO_URL,
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /planos/lista
router.get('/lista', (_req, res) => {
  res.json({
    checkout_url: CAKTO_URL,
    planos: [
      {
        id: 'gratuito', nome: 'Gratuito', preco: 0, periodo: 'para sempre',
        features: ['Até 5 alunos', '7 dias de agenda', 'Agendamentos ilimitados', 'Convites'],
        limitado: true
      },
      {
        id: 'pro', nome: 'Pro', preco: PRECO_PRO_BRL, periodo: 'por mês',
        features: ['Alunos ilimitados', '60 dias de agenda', 'Avaliações físicas', 'Histórico de evolução', 'Suporte prioritário'],
        limitado: false, destaque: true
      }
    ]
  });
});

// POST /planos/assinar — redireciona para Cakto
router.post('/assinar', authMiddleware, soPersonal, async (req, res) => {
  try {
    const pid = req.user.personal_id;

    // Registra intenção de compra no banco
    await db.from('assinaturas').insert({
      personal_id: pid,
      plano:       'pro',
      status:      'pendente',
      valor:       PRECO_PRO_BRL,
    }).select().single();

    // Retorna URL do checkout Cakto
    // O frontend redireciona o usuário para lá
    res.json({
      checkout_url: CAKTO_URL,
      mensagem:     'Redirecione o usuário para o checkout.'
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /planos/webhook — Cakto notifica pagamento aprovado
// Configure no painel Cakto: Webhook URL = https://sua-api.vercel.app/planos/webhook
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('Webhook Cakto recebido:', JSON.stringify(body, null, 2));

    // Cakto envia status "paid" quando pagamento confirmado
    // O payload varia conforme configuração do produto no Cakto
    // Campos comuns: status, customer.email, order_id, product_id

    const status     = body?.status || body?.payment_status;
    const email      = body?.customer?.email || body?.email;
    const aprovado   = ['paid', 'approved', 'complete', 'completed'].includes(
                         String(status).toLowerCase()
                       );

    if (aprovado && email) {
      // Encontra o personal pelo e-mail do comprador
      const { data: personal } = await db
        .from('personals')
        .select('id')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (personal) {
        const periodoFim = new Date();
        periodoFim.setMonth(periodoFim.getMonth() + 1);
        const periodoFimStr = periodoFim.toISOString().split('T')[0];

        // Ativa plano Pro
        await db.from('personals').update({
          plano:        'pro',
          plano_status: 'ativo',
          plano_expira: periodoFimStr,
        }).eq('id', personal.id);

        // Atualiza assinatura pendente
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

        console.log(`✅ Plano Pro ativado para: ${email} até ${periodoFimStr}`);
      } else {
        console.warn(`⚠️ Personal não encontrado para e-mail: ${email}`);
      }
    }

    // Sempre responde 200 para Cakto não retentar
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook erro:', e.message);
    res.sendStatus(200);
  }
});

// POST /planos/ativar-manual  [dev only — simula pagamento aprovado]
router.post('/ativar-manual', authMiddleware, soPersonal, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ erro: 'Não disponível em produção.' });
  }
  try {
    const pid        = req.user.personal_id;
    const periodoFim = new Date();
    periodoFim.setMonth(periodoFim.getMonth() + 1);
    const periodoFimStr = periodoFim.toISOString().split('T')[0];

    await db.from('personals').update({
      plano:        'pro',
      plano_status: 'ativo',
      plano_expira: periodoFimStr,
    }).eq('id', pid);

    await db.from('assinaturas').insert({
      personal_id:    pid,
      plano:          'pro',
      status:         'aprovado',
      mp_payment_id:  `dev_${Date.now()}`,
      mp_status:      'approved',
      valor:          PRECO_PRO_BRL,
      periodo_inicio: new Date().toISOString().split('T')[0],
      periodo_fim:    periodoFimStr,
    });

    res.json({ mensagem: 'Plano Pro ativado (modo dev).', expira_em: periodoFimStr });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
module.exports.LIMITES = LIMITES;
