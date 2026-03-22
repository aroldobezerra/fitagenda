const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token não fornecido.' });
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch (e) {
    const expirado = e.name === 'TokenExpiredError';
    res.status(401).json({
      erro: expirado ? 'Sessão expirada. Faça login novamente.' : 'Token inválido.',
      codigo: expirado ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO'
    });
  }
}

function soPersonal(req, res, next) {
  if (req.user?.role !== 'personal') {
    return res.status(403).json({ erro: 'Acesso exclusivo para personal trainers.' });
  }
  next();
}

function soAluno(req, res, next) {
  if (req.user?.role !== 'aluno') {
    return res.status(403).json({ erro: 'Acesso exclusivo para alunos.' });
  }
  next();
}

module.exports = { authMiddleware, soPersonal, soAluno };
