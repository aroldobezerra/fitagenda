const express = require('express');
const db = require('../lib/supabase');
const { authMiddleware, soPersonal } = require('../middleware/auth');

const router = express.Router();

// ─────────────────────────────────────────────────────────
// POST /agendar  — cria agendamento (público)
// ─────────────────────────────────────────────────────────
router.post('/agendar', async (req, res) => {
  try {
    const { horario_id, nome, telefone, observacao, aluno_id } = req.body;
    if (!horario_id || !nome || !telefone)
      return res.status(400).json({ erro: 'horario_id, nome e telefone obrigatórios.' });
    if (telefone.replace(/\D/g, '').length < 10)
      return res.status(400).json({ erro: 'Telefone inválido.' });

    const { data: h } = await db.from('horarios').select('*').eq('id', horario_id).maybeSingle();
    if (!h) return res.status(404).json({ erro: 'Horário não encontrado.' });
    if (!h.disponivel) return res.status(409).json({ erro: 'Horário já reservado.', codigo: 'HORARIO_OCUPADO' });

    const dataHora = new Date(`${h.data.substring(0, 10)}T${h.hora}:00`);
    if (dataHora <= new Date())
      return res.status(409).json({ erro: 'Horário já passou.', codigo: 'HORARIO_PASSADO' });

    const { data: ag, error } = await db.from('agendamentos')
      .insert({
        personal_id: h.personal_id,
        horario_id,
        aluno_id: aluno_id || null,
        nome: nome.trim(),
        telefone: telefone.trim(),
        observacao: observacao?.trim() || null
      })
      .select('id,nome,telefone')
      .single();

    if (error) {
      if (error.code === '23505')
        return res.status(409).json({ erro: 'Horário acabou de ser reservado.', codigo: 'HORARIO_OCUPADO' });
      throw error;
    }

    await db.from('horarios').update({ disponivel: false }).eq('id', horario_id);

    res.status(201).json({
      mensagem: 'Agendamento confirmado!',
      agendamento: {
        id: ag.id, horario_id,
        nome: ag.nome, telefone: ag.telefone,
        data: h.data.substring(0, 10), hora: h.hora
      }
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─────────────────────────────────────────────────────────
// GET /agenda-personal  [personal]
// ─────────────────────────────────────────────────────────
router.get('/agenda-personal', authMiddleware, soPersonal, async (req, res) => {
  try {
    const { data: filtroData, periodo = 'futuro' } = req.query;
    const pid  = req.user.personal_id;
    const hoje = new Date().toISOString().split('T')[0];

    const { data: rows, error } = await db
      .from('agendamentos')
      .select('id,aluno_id,nome,telefone,observacao,created_at,horarios(data,hora)')
      .eq('personal_id', pid);

    if (error) throw error;

    const filtrados = (rows || []).filter(r => {
      const d = r.horarios?.data?.substring(0, 10) || '';
      if (filtroData)          return d === filtroData;
      if (periodo === 'hoje')   return d === hoje;
      if (periodo === 'passado')return d < hoje;
      return d >= hoje; // futuro (default)
    });

    filtrados.sort((a, b) => {
      const da = (a.horarios?.data || '') + (a.horarios?.hora || '');
      const db_ = (b.horarios?.data || '') + (b.horarios?.hora || '');
      return da.localeCompare(db_);
    });

    const grouped = {};
    filtrados.forEach(r => {
      const d = r.horarios?.data?.substring(0, 10) || 'sem-data';
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push({
        id:          r.id,
        aluno_id:    r.aluno_id,
        hora:        r.horarios?.hora,
        nome:        r.nome,
        telefone:    r.telefone,
        observacao:  r.observacao,
        agendado_em: r.created_at
      });
    });

    const agenda = Object.entries(grouped).map(([d, treinos]) => ({
      data: d, total: treinos.length, treinos
    }));

    res.json({ total: filtrados.length, periodo, agenda });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─────────────────────────────────────────────────────────
// GET /agenda-aluno  [aluno]
// ─────────────────────────────────────────────────────────
router.get('/agenda-aluno', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'aluno')
      return res.status(403).json({ erro: 'Apenas alunos.' });

    const { data: rows, error } = await db
      .from('agendamentos')
      .select('id,nome,telefone,observacao,horarios(data,hora)')
      .eq('aluno_id', req.user.id);

    if (error) throw error;

    const agendamentos = (rows || []).map(r => ({
      id:         r.id,
      nome:       r.nome,
      telefone:   r.telefone,
      observacao: r.observacao,
      data:       r.horarios?.data?.substring(0, 10),
      hora:       r.horarios?.hora
    })).sort((a, b) => ((a.data || '') + (a.hora || '')).localeCompare((b.data || '') + (b.hora || '')));

    res.json({ agendamentos });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─────────────────────────────────────────────────────────
// DELETE /agendar/:id  [personal]
// ─────────────────────────────────────────────────────────
router.delete('/agendar/:id', authMiddleware, soPersonal, async (req, res) => {
  try {
    const pid = req.user.personal_id;
    const { data: ag } = await db
      .from('agendamentos')
      .select('id,horario_id')
      .eq('id', req.params.id)
      .eq('personal_id', pid)
      .maybeSingle();

    if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });

    await db.from('agendamentos').delete().eq('id', req.params.id);
    await db.from('horarios').update({ disponivel: true }).eq('id', ag.horario_id);

    res.json({ mensagem: 'Agendamento cancelado. Horário liberado.' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
