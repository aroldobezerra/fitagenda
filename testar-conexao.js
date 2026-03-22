/**
 * testar-conexao.js — testa se o Supabase está acessível
 * Execute: node testar-conexao.js
 */
require('dotenv').config();

console.log('\n🔍 Testando conexão com Supabase...\n');

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
let ok = true;

required.forEach(k => {
  if (!process.env[k]) {
    console.log(`❌ ${k} — faltando no .env`);
    ok = false;
  } else {
    const val = process.env[k];
    const preview = k === 'SUPABASE_URL' ? val : val.slice(0, 20) + '...';
    console.log(`✅ ${k} = ${preview}`);
  }
});

if (!ok) {
  console.log('\n⛔ Configure o .env antes de continuar.\n');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

async function main() {
  // Testa listagem da tabela personals
  const { data, error } = await db.from('personals').select('count').limit(1);

  if (error) {
    console.log('\n❌ Erro ao conectar ao Supabase:');
    console.log('  ', error.message);
    console.log('\nCausas comuns:');
    console.log('  • SUPABASE_SERVICE_KEY errada (use a "service_role", não a "anon")');
    console.log('  • Tabela "personals" não existe — execute o schema.sql no SQL Editor');
    console.log('  • URL do projeto errada');
  } else {
    console.log('\n✅ Conexão com Supabase OK!');
    console.log('✅ Tabela "personals" acessível');
    console.log('\n🚀 Tudo pronto. Inicie o backend com: npm run dev\n');
  }
}

main().catch(e => {
  console.error('\n❌ Erro inesperado:', e.message, '\n');
});
