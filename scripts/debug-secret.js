const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: 5432,
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const settings = await client.query(`
    select key, length(value) as len, left(value, 12) as head, right(value, 4) as tail
    from xml_nfse.settings
    order by key
  `);
  console.log('settings:', settings.rows);

  // Show assert_app_secret definition
  const def = await client.query(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'xml_nfse' and p.proname = 'assert_app_secret'
  `);
  console.log('assert def:\n', def.rows[0]?.def?.slice(0, 1500));

  // Test dashboard summary with settings value
  try {
    const s = await client.query(
      `select public.xml_nfse_get_dashboard_summary(
         (select value from xml_nfse.settings where key = 'app_secret' limit 1)
       ) as r`
    );
    console.log('summary ok, type', typeof s.rows[0].r, Array.isArray(s.rows[0].r) ? s.rows[0].r.length : Object.keys(s.rows[0].r || {}));
  } catch (e) {
    console.error('summary fail:', e.message);
  }

  // Try hash variants: maybe value is stored as plain but assert expects sha256 hex
  const crypto = require('crypto');
  const secretPlain = process.env.SUPABASE_APP_SECRET;
  if (secretPlain) {
    const hash = crypto.createHash('sha256').update(secretPlain).digest('hex');
    console.log('trying env secret len', secretPlain.length, 'sha256 head', hash.slice(0, 12));
    for (const candidate of [secretPlain, hash]) {
      try {
        const a = await client.query(
          `select public.xml_nfse_get_dashboard_analytics($1, $2, 12) as r`,
          [candidate, 'producao']
        );
        console.log('analytics OK with candidate len', candidate.length, 'docs', a.rows[0].r?.totals);
      } catch (e) {
        console.log('analytics FAIL candidate len', candidate.length, e.message);
      }
    }
  } else {
    console.log('No SUPABASE_APP_SECRET env — only settings path tested');
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
