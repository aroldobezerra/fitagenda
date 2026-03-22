// ── HORARIOS ────────────────────────────────────────────────
const express = require('express');
const db = require('../lib/supabase');
const { authMiddleware, soPersonal } = require('../middleware/auth');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { personal_id, data, dias = 7 } = req.query;
    if (!personal_id) return res.status(400).json({ erro: 'personal_id obrigatório.' });

    const hoje = new Date().toISOString().split('T')[0];
    const limite = new Date(); limite.setDate(limite.getDate() + Number(dias));
    const limiteStr = limite.toISOString().split('T')[0];

    let query = db.from('horarios').select('id,data,hora,disponivel')
      .eq('personal_id', personal_id)
      .gte('data', hoje)
      .lte('data', limiteStr)
      .order('data').order('hora');

    if (data) query = query.eq('data', data);

    const { data: rows, error } = await query;
    if (error) throw error;

    const agora = new Date().toISOString().slice(0, 16);
    const grouped = {};
    rows.forEach(h => {
      const dt = h.data.split('T')[0];
      const dtHora = `${dt}T${h.hora}`;
      if (dtHora > agora) {
        if (!grouped[dt]) grouped[dt] = [];
        grouped[dt].push({ id: h.id, hora: h.hora, disponivel: h.disponivel });
      }
    });

    const dias_result = Object.entries(grouped).map(([d, slots]) => ({
      data: d, total: slots.length,
      disponiveis: slots.filter(s => s.disponivel).length, slots
    }));

    res.json({ personal_id, dias: dias_result });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/', authMiddleware, soPersonal, async (req, res) => {
  try {
    const { data, horas } = req.body;
    const pid = req.user.personal_id;
    if (!data || !Array.isArray(horas)) return res.status(400).json({ erro: 'data e horas[] obrigatórios.' });

    const inserts = horas.map(hora => ({ personal_id: pid, data, hora }));
    const { data: criados, error } = await db.from('horarios').upsert(inserts, { onConflict: 'personal_id,data,hora', ignoreDuplicates: true }).select('data,hora');
    if (error) throw error;
    res.status(201).json({ mensagem: `${criados?.length || 0} horário(s) criado(s).`, criados });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/lote', authMiddleware, soPersonal, async (req, res) => {
  try {
    const { dias_da_semana, semanas = 4, horas } = req.body;
    const pid = req.user.personal_id;
    if (!Array.isArray(dias_da_semana) || !Array.isArray(horas)) {
      return res.status(400).json({ erro: 'dias_da_semana[] e horas[] obrigatórios.' });
    }

    const inserts = [];
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    for (let w = 0; w < semanas * 7; w++) {
      const d = new Date(hoje); d.setDate(d.getDate() + w);
      if (dias_da_semana.includes(d.getDay())) {
        const data = d.toISOString().split('T')[0];
        horas.forEach(hora => inserts.push({ personal_id: pid, data, hora }));
      }
    }

    const { data: criados, error } = await db.from('horarios').upsert(inserts, { onConflict: 'personal_id,data,hora', ignoreDuplicates: true }).select('data,hora');
    if (error) throw error;
    res.status(201).json({ mensagem: `${criados?.length || 0} horário(s) criado(s) em lote.`, criados });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.delete('/:id', authMiddleware, soPersonal, async (req, res) => {
  try {
    const pid = req.user.personal_id;
    const { data: h } = await db.from('horarios').select('id').eq('id', req.params.id).eq('personal_id', pid).maybeSingle();
    if (!h) return res.status(404).json({ erro: 'Horário não encontrado.' });

    const { data: ag } = await db.from('agendamentos').select('id').eq('horario_id', req.params.id).maybeSingle();
    if (ag) return res.status(409).json({ erro: 'Horário possui agendamento. Cancele antes.' });

    await db.from('horarios').delete().eq('id', req.params.id);
    res.json({ mensagem: 'Horário removido.' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
