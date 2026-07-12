/**
 * Aplica um arquivo SQL no Postgres (uso pontual).
 * Uso: node scripts/apply-sql-file.js path/to/file.sql
 * DATABASE_URL deve estar no ambiente (não commitar senha).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const file = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!file || !url) {
    console.error('Uso: DATABASE_URL=... node scripts/apply-sql-file.js <arquivo.sql>');
    process.exit(1);
  }
  const sql = fs.readFileSync(path.resolve(file), 'utf8');
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000
  });
  await client.connect();
  console.log('Conectado. Aplicando', file, `(${sql.length} chars)...`);
  await client.query(sql);
  console.log('OK');
  await client.end();
}

main().catch((err) => {
  console.error('Falha:', err.message);
  process.exit(1);
});
