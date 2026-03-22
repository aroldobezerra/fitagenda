const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db       = require('../lib/supabase');
const { authMiddleware, soPersonal } = require('../middleware/auth');

const router = express.Router();

function token(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}

// POST /auth/personal/register
router.post('/personal/register', async (req, res) => {
  try {
    const { nome, email, senha, telefone, especialidade } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'nome, email e senha obrigatórios.' });
    if (senha.length < 6) return res.status(400).json({ erro: 'Senha mínimo 6 caracteres.' });

    const { data: existe } = await db.from('personals').select('id').eq('email', email.toLowerCase()).maybeSingle();
    if (existe) return res.status(409).json({ erro: 'E-mail já cadastrado.' });

    const senha_hash = bcrypt.hashSync(senha, 10);
    const { data: p, error } = await db.from('personals')
      .insert({ nome: nome.trim(), email: email.toLowerCase().trim(), senha_hash, telefone: telefone || null, especialidade: especialidade || null })
      .select('id,nome,email,telefone,especialidade,plano')
      .single();

    if (error) throw error;

    const t = token({ id: p.id, nome: p.nome, email: p.email, role: 'personal', personal_id: p.id });
    res.status(201).json({ token: t, usuario: { ...p, role: 'personal' } });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// POST /auth/personal/login
router.post('/personal/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha obrigatórios.' });

    const { data: p } = await db.from('personals').select('*').eq('email', email.toLowerCase()).eq('ativo', true).maybeSingle();
    if (!p || !bcrypt.compareSync(senha, p.senha_hash)) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const t = token({ id: p.id, nome: p.nome, email: p.email, role: 'personal', personal_id: p.id });
    res.json({ token: t, usuario: { id: p.id, nome: p.nome, email: p.email, telefone: p.telefone, especialidade: p.especialidade, plano: p.plano, role: 'personal' } });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// POST /auth/aluno/login
router.post('/aluno/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha obrigatórios.' });

    const { data: a } = await db.from('alunos').select('*').eq('email', email.toLowerCase()).eq('ativo', true).maybeSingle();
    if (!a || !a.senha_hash || !bcrypt.compareSync(senha, a.senha_hash)) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const { data: p } = await db.from('personals').select('nome,especialidade').eq('id', a.personal_id).maybeSingle();
    const t = token({ id: a.id, nome: a.nome, email: a.email, role: 'aluno', personal_id: a.personal_id });
    res.json({ token: t, usuario: { id: a.id, nome: a.nome, email: a.email, telefone: a.telefone, role: 'aluno', personal_id: a.personal_id, personal_nome: p?.nome } });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// POST /auth/convites
router.post('/convites', authMiddleware, soPersonal, async (req, res) => {
  try {
    const { nome_aluno, email_aluno } = req.body;
    const pid = req.user.personal_id;
    const expires_at = new Date(); expires_at.setDate(expires_at.getDate() + 7);
    const tok = uuid();

    const { error } = await db.from('convites').insert({
      personal_id: pid, token: tok,
      nome_aluno: nome_aluno || null, email_aluno: email_aluno?.toLowerCase() || null,
      expires_at: expires_at.toISOString().split('T')[0]
    });
    if (error) throw error;

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    res.status(201).json({ mensagem: 'Convite criado.', token: tok, link: `${frontendUrl}/convite/${tok}`, expira_em: expires_at.toISOString().split('T')[0] });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /auth/convites
router.get('/convites', authMiddleware, soPersonal, async (req, res) => {
  try {
    const { data, error } = await db.from('convites')
      .select('*, alunos(nome)')
      .eq('personal_id', req.user.personal_id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ convites: data.map(c => ({ ...c, aluno_nome_cadastrado: c.alunos?.nome })) });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /auth/convite/:token
router.get('/convite/:token', async (req, res) => {
  try {
    const { data: c, error } = await db.from('convites')
      .select('*, personals(nome, especialidade, telefone)')
      .eq('token', req.params.token).maybeSingle();

    if (error || !c) return res.status(404).json({ erro: 'Convite não encontrado.' });
    if (c.usado) return res.status(409).json({ erro: 'Convite já utilizado.' });
    if (new Date(c.expires_at) < new Date()) return res.status(410).json({ erro: 'Convite expirado.' });

    res.json({ valido: true, convite: {
      token: c.token, nome_aluno: c.nome_aluno, email_aluno: c.email_aluno,
      personal_nome: c.personals?.nome, especialidade: c.personals?.especialidade,
      expira_em: c.expires_at
    }});
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// POST /auth/aceitar-convite
router.post('/aceitar-convite', async (req, res) => {
  try {
    const { token: tok, nome, email, telefone, senha } = req.body;
    if (!tok || !nome || !email || !senha) return res.status(400).json({ erro: 'Campos obrigatórios faltando.' });
    if (senha.length < 6) return res.status(400).json({ erro: 'Senha mínimo 6 caracteres.' });

    const { data: c } = await db.from('convites').select('*, personals(nome)').eq('token', tok).maybeSingle();
    if (!c) return res.status(404).json({ erro: 'Convite inválido.' });
    if (c.usado) return res.status(409).json({ erro: 'Convite já utilizado.' });
    if (new Date(c.expires_at) < new Date()) return res.status(410).json({ erro: 'Convite expirado.' });

    const emailNorm = email.toLowerCase().trim();
    const { data: existe } = await db.from('alunos').select('id').eq('personal_id', c.personal_id).eq('email', emailNorm).maybeSingle();
    if (existe) return res.status(409).json({ erro: 'E-mail já cadastrado com este personal.' });

    const senha_hash = bcrypt.hashSync(senha, 10);
    const { data: aluno, error } = await db.from('alunos')
      .insert({ personal_id: c.personal_id, nome: nome.trim(), email: emailNorm, telefone: telefone || null, senha_hash })
      .select('id,nome,email,telefone,personal_id').single();
    if (error) throw error;

    await db.from('convites').update({ usado: true, aluno_id: aluno.id }).eq('id', c.id);

    const t = token({ id: aluno.id, nome: aluno.nome, email: aluno.email, role: 'aluno', personal_id: aluno.personal_id });
    res.status(201).json({ mensagem: 'Conta criada!', token: t, usuario: { ...aluno, role: 'aluno', personal_nome: c.personals?.nome } });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { id, role, personal_id } = req.user;
    if (role === 'personal') {
      const { data } = await db.from('personals').select('id,nome,email,telefone,especialidade,plano,created_at').eq('id', id).maybeSingle();
      return res.json({ ...data, role: 'personal' });
    }
    const { data: a } = await db.from('alunos').select('id,nome,email,telefone,created_at').eq('id', id).maybeSingle();
    const { data: p } = await db.from('personals').select('nome').eq('id', personal_id).maybeSingle();
    res.json({ ...a, role: 'aluno', personal_id, personal_nome: p?.nome });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
