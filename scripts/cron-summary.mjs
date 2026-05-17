// Summary of the most recent weekly rescrape run.
//
// Run Sunday morning (or any time after a cron fires) to see what
// happened during the last batch. Connects via DATABASE_URL.
//
// Usage:
//   node scripts/cron-summary.mjs           # defaults to last 6 hours
//   node scripts/cron-summary.mjs --hours 24
//
// Output: counts by scrape_run.status + details for broken/error rows.
// The Inngest weeklyRescrapeSummary function ships the same digest
// automatically via email; this script is for ad-hoc inspection.

import pg from "pg";
import { config } from "dotenv";
config({ path: ".env.local" });

const dbUri = process.env.DATABASE_URL;
if (!dbUri || dbUri.length === 0) {
  console.error(
    "DATABASE_URL not set in .env.local — paste prod connection string first",
  );
  process.exit(1);
}

const hoursArg = process.argv.indexOf("--hours");
const hours =
  hoursArg >= 0 ? Number(process.argv[hoursArg + 1] ?? "6") : 6;
if (!Number.isFinite(hours) || hours <= 0) {
  console.error("--hours must be a positive number");
  process.exit(1);
}

const c = new pg.Client({ connectionString: dbUri });
await c.connect();

const meta = await c.query("SELECT current_database() AS db, NOW() AS now");
console.log(`Connected to: ${meta.rows[0].db}`);
console.log(`Now (UTC):    ${meta.rows[0].now.toISOString()}`);
console.log(`Window:       last ${hours}h\n`);

const counts = await c.query(
  `
  SELECT status, COUNT(*)::int AS n
    FROM scrape_run
   WHERE started_at >= NOW() - ($1 || ' hours')::interval
   GROUP BY status
   ORDER BY n DESC
  `,
  [String(hours)],
);

if (counts.rows.length === 0) {
  console.log("No scrape_run rows in window. Cron hasn't fired yet, or DB is unreachable.");
  await c.end();
  process.exit(0);
}

console.log("Counts by status:");
console.table(counts.rows);

// Show details for any broken/error rows
const issues = await c.query(
  `
  SELECT
    sr.id          AS run_id,
    sr.shul_id,
    s.slug,
    s.name,
    sr.data_source_id,
    sr.status      AS run_status,
    sr.rules_added,
    sr.rules_removed,
    sr.error,
    sr.started_at
    FROM scrape_run sr
    JOIN shul s ON s.id = sr.shul_id
   WHERE sr.started_at >= NOW() - ($1 || ' hours')::interval
     AND sr.status IN ('broken', 'error')
   ORDER BY sr.started_at DESC
  `,
  [String(hours)],
);

// Use full URLs so they're clickable from anywhere this script is run
// (terminal, piped to email, copied into a doc, etc.).
const BASE_URL = (process.env.AUTH_URL?.trim() || "https://tfila.co").replace(/\/$/, "");

if (issues.rows.length > 0) {
  console.log(`\nBroken / error runs (${issues.rows.length}):`);
  for (const r of issues.rows) {
    console.log(
      `\n  [${r.run_status}] ${r.name} (shul ${r.shul_id} · ds ${r.data_source_id})`,
    );
    console.log(`    url:    ${BASE_URL}/admin/shul/${r.slug}`);
    console.log(`    when:   ${r.started_at.toISOString()}`);
    if (r.error) console.log(`    error:  ${r.error}`);
  }
} else {
  console.log("\nNo broken/error runs in window. ✓");
}

// Quick stale-gate signal: how many active shuls have NO fresh data_source?
const stale = await c.query(
  `
  SELECT COUNT(*)::int AS n
    FROM shul s
   WHERE s.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM data_source ds
        WHERE ds.shul_id = s.id
          AND ds.last_run_status = 'ok'
          AND COALESCE(ds.last_received_at, ds.last_run_at) >= NOW() - INTERVAL '14 days'
     )
  `,
);
console.log(
  `\nActive shuls currently HIDDEN by stale-gate (no fresh data_source in 14d): ${stale.rows[0].n}`,
);

await c.end();
