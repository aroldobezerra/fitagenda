const express = require('express');
const db = require('../lib/supabase');
const { authMiddleware, soPersonal } = require('../middleware/auth');

// ── ALUNOS ──────────────────────────────────────────────────
const alunosRouter = express.Router();
alunosRouter.use(authMiddleware, soPersonal);

alunosRouter.get('/', async (req, res) => {
  try {
    const pid = req.user.personal_id;
    const { data, error } = await db
      .from('alunos')
      .select('id,nome,email,telefone,ativo,created_at')
      .eq('personal_id', pid)
      .eq('ativo', true)
      .order('nome');
    if (error) throw error;

    const [{ data: ags }, { data: avs }] = await Promise.all([
      db.from('agendamentos').select('aluno_id').eq('personal_id', pid),
      db.from('avaliacoes_fisicas').select('aluno_id,data').eq('personal_id', pid).order('data', { ascending: false })
    ]);

    const agCount = {}, avCount = {}, ultimaAv = {};
    (ags || []).forEach(a => { agCount[a.aluno_id] = (agCount[a.aluno_id] || 0) + 1; });
    (avs || []).forEach(a => {
      avCount[a.aluno_id] = (avCount[a.aluno_id] || 0) + 1;
      if (!ultimaAv[a.aluno_id]) ultimaAv[a.aluno_id] = a.data;
    });

    res.json({
      total: data.length,
      alunos: data.map(a => ({
        ...a,
        total_agendamentos: agCount[a.id] || 0,
        total_avaliacoes:   avCount[a.id] || 0,
        ultima_avaliacao:   ultimaAv[a.id] || null
      }))
    });
  } catch (e) {
    console.error('GET /alunos erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

alunosRouter.patch('/:id', async (req, res) => {
  try {
    const pid = req.user.personal_id;
    const { nome, telefone } = req.body;
    const updates = {};
    if (nome)     updates.nome     = nome.trim();
    if (telefone) updates.telefone = telefone.trim();
    await db.from('alunos').update(updates).eq('id', req.params.id).eq('personal_id', pid);
    res.json({ mensagem: 'Dados atualizados.' });
  } catch (e) {
    console.error('PATCH /alunos erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

alunosRouter.delete('/:id', async (req, res) => {
  try {
    await db.from('alunos')
      .update({ ativo: false })
      .eq('id', req.params.id)
      .eq('personal_id', req.user.personal_id);
    res.json({ mensagem: 'Aluno desativado.' });
  } catch (e) {
    console.error('DELETE /alunos erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── AVALIAÇÕES ──────────────────────────────────────────────
const avalRouter = express.Router();
avalRouter.use(authMiddleware, soPersonal);

// POST /avaliacao  — registra nova avaliação
avalRouter.post('/', async (req, res) => {
  try {
    const { aluno_id, nome, telefone, data, peso, altura, gordura, musculo, obs } = req.body;
    const pid = req.user.personal_id;

    if (!nome || !data || !peso || !altura) {
      return res.status(400).json({ erro: 'nome, data, peso e altura são obrigatórios.' });
    }

    const imc = +(parseFloat(peso) / ((parseFloat(altura) / 100) ** 2)).toFixed(1);

    const { data: av, error } = await db
      .from('avaliacoes_fisicas')
      .insert({
        personal_id: pid,
        aluno_id:    aluno_id || null,
        nome:        nome.trim(),
        telefone:    telefone?.trim() || null,
        data:        data,
        peso:        parseFloat(peso),
        altura:      parseFloat(altura),
        gordura:     gordura  ? parseFloat(gordura)  : null,
        musculo:     musculo  ? parseFloat(musculo)  : null,
        imc,
        obs:         obs?.trim() || null
      })
      .select('id,nome,data,peso,altura,imc')
      .single();

    if (error) {
      console.error('Supabase INSERT avaliacao erro:', error);
      throw error;
    }

    res.status(201).json({ mensagem: 'Avaliação registrada.', avaliacao: av });
  } catch (e) {
    console.error('POST /avaliacao erro:', e.message, e.details || '');
    res.status(500).json({ erro: e.message, detalhe: e.details || e.hint || '' });
  }
});

// GET /avaliacoes  — lista alunos com avaliações
avalRouter.get('/', async (req, res) => {
  try {
    const pid = req.user.personal_id;
    const { data, error } = await db
      .from('avaliacoes_fisicas')
      .select('nome,telefone,data,peso,imc')
      .eq('personal_id', pid)
      .order('data', { ascending: false });
    if (error) throw error;

    const grouped = {};
    (data || []).forEach(r => {
      if (!grouped[r.nome]) {
        grouped[r.nome] = {
          nome:             r.nome,
          telefone:         r.telefone,
          total:            0,
          ultima_avaliacao: r.data,
          ultimo_peso:      r.peso,
          ultimo_imc:       r.imc
        };
      }
      grouped[r.nome].total++;
    });

    res.json({ total: Object.keys(grouped).length, alunos: Object.values(grouped) });
  } catch (e) {
    console.error('GET /avaliacoes erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// DELETE /avaliacoes/registro/:id  — ATENÇÃO: DELETE, não GET
avalRouter.delete('/registro/:id', async (req, res) => {
  try {
    const { error } = await db
      .from('avaliacoes_fisicas')
      .delete()
      .eq('id', req.params.id)
      .eq('personal_id', req.user.personal_id);
    if (error) throw error;
    res.json({ mensagem: 'Avaliação removida.' });
  } catch (e) {
    console.error('DELETE /avaliacoes/registro erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// GET /avaliacoes/:nome  — histórico + evolução de um aluno
avalRouter.get('/:nome', async (req, res) => {
  try {
    const pid  = req.user.personal_id;
    const nome = decodeURIComponent(req.params.nome);

    const { data: rows, error } = await db
      .from('avaliacoes_fisicas')
      .select('*')
      .eq('personal_id', pid)
      .ilike('nome', `%${nome}%`)
      .order('data', { ascending: false });

    if (error) throw error;
    if (!rows?.length) {
      return res.status(404).json({ erro: `Nenhuma avaliação encontrada para "${nome}".` });
    }

    const sorted   = [...rows].sort((a, b) => a.data.localeCompare(b.data));
    const primeira = sorted[0];
    const ultima   = sorted[sorted.length - 1];

    const evolucao = rows.length > 1 ? {
      periodo_dias: Math.round((new Date(ultima.data) - new Date(primeira.data)) / 86400000),
      peso_diff_kg: +(ultima.peso - primeira.peso).toFixed(1),
      gordura_diff: primeira.gordura && ultima.gordura
        ? +(ultima.gordura - primeira.gordura).toFixed(1) : null,
      imc_diff: +(ultima.imc - primeira.imc).toFixed(1)
    } : null;

    res.json({
      aluno:            rows[0].nome,
      telefone:         rows[0].telefone,
      total_avaliacoes: rows.length,
      evolucao,
      historico:        rows
    });
  } catch (e) {
    console.error('GET /avaliacoes/:nome erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

module.exports = { alunosRouter, avalRouter };
