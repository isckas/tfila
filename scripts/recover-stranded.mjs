// Recover stranded shuls by re-extracting them through the (now v1-only)
// pipeline. They were demoted to review_status='pending' + shul.status=
// 'pending_review' by the pre-P1 code during the 2026-05-24 429 storm; they
// broke on TRANSIENT 429s, so a throttled re-extraction recovers most of them.
//
// Sends `shul.scrape.requested` per stranded source → scrapeOneShul re-extracts
// and, on success, restores review_status='approved' + last_run_status='ok'
// (visible again via the P0 derived-visibility query). Inngest throttles to the
// global concurrency cap (3), so this can't re-trigger the storm.
//
// Usage:
//   node scripts/recover-stranded.mjs            # 1 shul (verify)
//   node scripts/recover-stranded.mjs 50         # up to 50
//   node scripts/recover-stranded.mjs 50 --dry   # list only, don't send
import { config } from "dotenv";
config({ path: ".env.local" });
import pg from "pg";

const limit = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 1);
const dryRun = process.argv.includes("--dry");

const eventKey = process.env.INNGEST_EVENT_KEY;
if (!eventKey) throw new Error("INNGEST_EVENT_KEY not set (check .env.local)");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query(
  `SELECT ds.id AS data_source_id, ds.shul_id, s.slug, ds.extraction_strategy::text AS strategy
     FROM data_source ds JOIN shul s ON s.id = ds.shul_id
    WHERE ds.last_run_status = 'broken'
      AND ds.review_status = 'pending'
      AND s.status = 'pending_review'
      AND COALESCE(ds.extraction_strategy::text, 'html') <> 'failed'
    ORDER BY ds.shul_id
    LIMIT $1`,
  [limit],
);

console.log(`Stranded sources to recover (limit ${limit}): ${rows.length}`);
for (const r of rows) {
  console.log(`  shul ${r.shul_id} (${r.slug}) · ds ${r.data_source_id} · ${r.strategy}`);
}

if (dryRun || rows.length === 0) {
  console.log(dryRun ? "\n--dry: nothing sent." : "\nNothing to recover.");
  await pool.end();
  process.exit(0);
}

let sent = 0;
for (const r of rows) {
  const res = await fetch(`https://inn.gs/e/${eventKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "shul.scrape.requested",
      data: { shulId: r.shul_id, dataSourceId: r.data_source_id, reason: "manual" },
    }),
  });
  console.log(`  sent shul ${r.shul_id} → HTTP ${res.status}`);
  if (res.ok) sent++;
}

await pool.end();
console.log(
  `\nQueued ${sent}/${rows.length}. Inngest runs scrapeOneShul throttled to 3 concurrent; check scrape_run / data_source in a few minutes.`,
);
