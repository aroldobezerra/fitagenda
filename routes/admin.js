const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../lib/supabase');

const router = express.Router();

// ── Middleware admin ──────────────────────────────────────
function authAdmin(req, res, next) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ erro: 'Token não fornecido.' });
  try {
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if (decoded.role !== 'admin')
      return res.status(403).json({ erro: 'Acesso negado.' });
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido.' });
  }
}

// ─────────────────────────────────────────────────────────
// POST /admin/login
// ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha)
      return res.status(400).json({ erro: 'E-mail e senha obrigatórios.' });

    const { data: admin } = await db
      .from('admins').select('*')
      .eq('email', email.toLowerCase()).eq('ativo', true).maybeSingle();

    if (!admin || !bcrypt.compareSync(senha, admin.senha_hash))
      return res.status(401).json({ erro: 'Credenciais inválidas.' });

    const token = jwt.sign(
      { id: admin.id, nome: admin.nome, email: admin.email, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, admin: { id: admin.id, nome: admin.nome, email: admin.email } });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─────────────────────────────────────────────────────────
// GET /admin/dashboard — métricas gerais
// ─────────────────────────────────────────────────────────
router.get('/dashboard', authAdmin, async (req, res) => {
  try {
    const [
      { count: totalPersonais },
      { count: totalAlunos },
      { count: totalAgendamentos },
      { count: totalAvaliacoes },
      { data: planos },
    ] = await Promise.all([
      db.from('personals').select('*', { count: 'exact', head: true }).eq('ativo', true),
      db.from('alunos').select('*', { count: 'exact', head: true }).eq('ativo', true),
      db.from('agendamentos').select('*', { count: 'exact', head: true }),
      db.from('avaliacoes_fisicas').select('*', { count: 'exact', head: true }),
      db.from('personals').select('plano'),
    ]);

    const porPlano = { gratuito: 0, pro: 0 };
    (planos || []).forEach(p => { porPlano[p.plano] = (porPlano[p.plano] || 0) + 1; });

    // Receita estimada (apenas pros ativos)
    const mrr = porPlano.pro * 49.90;

    res.json({
      totais: {
        personais:    totalPersonais || 0,
        alunos:       totalAlunos    || 0,
        agendamentos: totalAgendamentos || 0,
        avaliacoes:   totalAvaliacoes   || 0,
      },
      planos: porPlano,
      mrr: mrr.toFixed(2),
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─────────────────────────────────────────────────────────
// GET /admin/personais — lista todos os personais
// ─────────────────────────────────────────────────────────
router.get('/personais', authAdmin, async (req, res) => {
  try {
    const { busca, plano, pagina = 1, limite = 20 } = req.query;
    const offset = (Number(pagina) - 1) * Number(limite);

    let query = db.from('personals')
      .select('id,nome,email,telefone,especialidade,plano,plano_status,plano_expira,ativo,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limite) - 1);

    if (busca) query = query.or(`nome.ilike.%${busca}%,email.ilike.%${busca}%`);
    if (plano) query = query.eq('plano', plano);

    const { data, count, error } = await query;
    if (error) throw error;

    // Conta alunos por personal
    const { data: alunos } = await db
      .from('alunos').select('personal_id').eq('ativo', true);

    const alunosPorPersonal = {};
    (alunos || []).forEach(a => {
      alunosPorPersonal[a.personal_id] = (alunosPorPersonal[a.personal_id] || 0) + 1;
    });

    res.json({
      total: count || 0,
      pagina: Number(pagina),
      personais: (data || []).map(p => ({
        ...p,
        total_alunos: alunosPorPersonal[p.id] || 0,
      }))
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─────────────────────────────────────────────────────────
// GET /admin/personais/:id — detalhes de um personal
// ─────────────────────────────────────────────────────────
router.get('/personais/:id', authAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [
      { data: personal },
      { data: alunos },
      { count: totalAg },
      { count: totalAv },
      { data: assinaturas },
    ] = await Promise.all([
      db.from('personals').select('*').eq('id', id).maybeSingle(),
      db.from('alunos').select('id,nome,email,telefone,created_at').eq('personal_id', id).eq('ativo', true).order('nome'),
      db.from('agendamentos').select('*', { count: 'exact', head: true }).eq('personal_id', id),
      db.from('avaliacoes_fisicas').select('*', { count: 'exact', head: true }).eq('personal_id', id),
      db.from('assinaturas').select('*').eq('personal_id', id).order('created_at', { ascending: false }).limit(5),
    ]);

    if (!personal) return res.status(404).json({ erro: 'Personal não encontrado.' });

    res.json({
      personal,
      alunos:       alunos || [],
      total_agendamentos: totalAg || 0,
      total_avaliacoes:   totalAv || 0,
      assinaturas:  assinaturas || [],
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─────────────────────────────────────────────────────────
// PATCH /admin/personais/:id — editar personal
// ─────────────────────────────────────────────────────────
router.patch('/personais/:id', authAdmin, async (req, res) => {
  try {
    const { ativo, plano, plano_status, plano_expira } = req.body;
    const updates = {};
    if (ativo         !== undefined) updates.ativo         = ativo;
    if (plano)                       updates.plano         = plano;
    if (plano_status)                updates.plano_status  = plano_status;
    if (plano_expira)                updates.plano_expira  = plano_expira;

    const { error } = await db.from('personals').update(updates).eq('id', req.params.id);
    if (error) throw error;
    res.json({ mensagem: 'Personal atualizado.' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─────────────────────────────────────────────────────────
// POST /admin/personais/:id/ativar-pro — ativa plano pro manualmente
// ─────────────────────────────────────────────────────────
router.post('/personais/:id/ativar-pro', authAdmin, async (req, res) => {
  try {
    const { meses = 1 } = req.body;
    const expira = new Date();
    expira.setMonth(expira.getMonth() + Number(meses));
    const expiraStr = expira.toISOString().split('T')[0];

    await db.from('personals').update({
      plano:        'pro',
      plano_status: 'ativo',
      plano_expira: expiraStr,
    }).eq('id', req.params.id);

    await db.from('assinaturas').insert({
      personal_id:    req.params.id,
      plano:          'pro',
      status:         'aprovado',
      mp_payment_id:  `admin_manual_${Date.now()}`,
      mp_status:      'approved',
      valor:          49.90,
      periodo_inicio: new Date().toISOString().split('T')[0],
      periodo_fim:    expiraStr,
    });

    res.json({ mensagem: `Plano Pro ativado por ${meses} mês(es).`, expira_em: expiraStr });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─────────────────────────────────────────────────────────
// DELETE /admin/personais/:id — suspende personal
// ─────────────────────────────────────────────────────────
router.delete('/personais/:id', authAdmin, async (req, res) => {
  try {
    await db.from('personals').update({ ativo: false }).eq('id', req.params.id);
    res.json({ mensagem: 'Personal suspenso.' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─────────────────────────────────────────────────────────
// GET /admin/assinaturas — histórico de pagamentos
// ─────────────────────────────────────────────────────────
router.get('/assinaturas', authAdmin, async (req, res) => {
  try {
    const { data, error } = await db
      .from('assinaturas')
      .select('*, personals(nome,email)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    const total_mrr = (data || [])
      .filter(a => a.status === 'aprovado')
      .reduce((acc, a) => acc + Number(a.valor || 0), 0);

    res.json({
      total_mrr: total_mrr.toFixed(2),
      assinaturas: (data || []).map(a => ({
        ...a,
        personal_nome:  a.personals?.nome,
        personal_email: a.personals?.email,
      }))
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
