const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const docs = await client.query(
    "select count(*)::int as docs from xml_nfse.documents where tipo <> 'EVENTO'"
  );
  console.log('docs', docs.rows[0]);

  const keys = await client.query(
    "select key, left(value, 20) as v from xml_nfse.settings order by key"
  );
  console.log('settings', keys.rows);

  const secretRow = await client.query(
    "select value from xml_nfse.settings where key = 'app_secret' limit 1"
  );
  const secret = secretRow.rows[0]?.value;
  if (!secret) {
    console.log('app_secret not found in settings');
    await client.end();
    return;
  }

  const analytics = await client.query(
    'select public.xml_nfse_get_dashboard_analytics($1, $2, 12) as data',
    [secret, 'producao']
  );
  const data = analytics.rows[0]?.data;
  console.log('totals', data?.totals);
  console.log('monthly sample', (data?.monthly || []).slice(0, 3));
  console.log('ranking prestador', (data?.rankingPrestador || []).slice(0, 2));

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
