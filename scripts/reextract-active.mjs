// Re-extract ACTIVE shuls whose approved website source still has fixed-clock
// evening (mincha/maariv) rules — so the new E-C1 prompt can re-evaluate them
// as zmanim-anchored where the source describes them relative to a zman.
//
// Clears the stored page_content_hash first so scrapeOneShul can't short-circuit
// to no_change, then sends shul.scrape.requested (which keeps the source
// approved on success — sticky). Throttled by the global concurrency cap (3).
//
//   node scripts/reextract-active.mjs [--dry]
import { config } from "dotenv";
config({ path: ".env.local" });
import pg from "pg";

const dry = process.argv.includes("--dry");
const eventKey = process.env.INNGEST_EVENT_KEY;
if (!eventKey) throw new Error("INNGEST_EVENT_KEY not set");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query(`
  SELECT DISTINCT ds.id AS data_source_id, ds.shul_id, s.slug,
         count(mr.id) FILTER (WHERE mr.tefillah IN ('mincha','maariv') AND mr.time->>'kind'='fixed') OVER (PARTITION BY ds.id) AS fixed_evening
    FROM data_source ds
    JOIN shul s ON s.id = ds.shul_id
    JOIN minyan_rule mr ON mr.data_source_id = ds.id AND mr.deleted_at IS NULL
   WHERE s.status = 'active'
     AND ds.review_status = 'approved'
     AND ds.kind <> 'email_newsletter'
     AND mr.tefillah IN ('mincha','maariv')
     AND mr.time->>'kind' = 'fixed'
   ORDER BY ds.shul_id`);

const seen = new Set();
const targets = rows.filter((r) => (seen.has(r.data_source_id) ? false : seen.add(r.data_source_id)));

console.log(`${targets.length} active source(s) with fixed evening times to re-extract${dry ? " (DRY)" : ""}:`);
for (const r of targets) console.log(`  ${r.slug}  (ds ${r.data_source_id}, ${r.fixed_evening} fixed evening rules)`);

if (dry || targets.length === 0) { await pool.end(); process.exit(0); }

await pool.query(
  `UPDATE data_source SET config_json = config_json #- '{page_content_hash}' WHERE id = ANY($1::int[])`,
  [targets.map((r) => r.data_source_id)],
);

let sent = 0;
for (const r of targets) {
  const res = await fetch(`https://inn.gs/e/${eventKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "shul.scrape.requested", data: { shulId: r.shul_id, dataSourceId: r.data_source_id, reason: "manual" } }),
  });
  console.log(`  ${r.slug} → HTTP ${res.status}`);
  if (res.ok) sent++;
}
await pool.end();
console.log(`\nQueued ${sent}. Throttled to 3-concurrent; the new prompt re-evaluates evening times. Check in ~10 min.`);
