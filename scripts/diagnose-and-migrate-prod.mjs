import pg from "pg";
const URI = process.env.PROD_DATABASE_URL;
if (!URI) { console.error("set PROD_DATABASE_URL"); process.exit(1); }
const c = new pg.Client({ connectionString: URI });
await c.connect();

console.log("\n=== shuls (last 5 by submitted_at) ===");
console.table(
  (await c.query(`
    select id, slug, name, status, submitted_url, match_domain,
           submitted_at
      from shul
      order by submitted_at desc
      limit 5
  `)).rows,
);

console.log("\n=== email_newsletter data_sources (last 5) ===");
console.table(
  (await c.query(`
    select id, shul_id, kind, identifier, review_status,
           last_run_status, last_received_at, last_run_at
      from data_source
      where kind = 'email_newsletter'
      order by id desc
      limit 5
  `)).rows,
);

console.log("\n=== data_sources w/ failed run (last 5) ===");
console.table(
  (await c.query(`
    select id, shul_id, kind, identifier, last_run_status, last_run_at,
           jsonb_pretty(config_json) as cfg
      from data_source
      where last_run_status != 'ok' or last_run_status is null
      order by id desc
      limit 5
  `)).rows,
);

console.log("\n=== any 'Safra' anywhere? ===");
console.table(
  (await c.query(`
    select id, slug, name, status, match_domain
      from shul
      where name ilike '%safra%' or slug ilike '%safra%'
  `)).rows,
);

await c.end();
