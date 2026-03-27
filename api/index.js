require('dotenv').config();
const app = require('../server');

// Exporta como handler Vercel
module.exports = app;
