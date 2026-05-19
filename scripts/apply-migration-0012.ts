// One-shot runner for migration 0012_data_source_unique_identifier.sql.
// Creates the partial UNIQUE INDEX on data_source(shul_id, identifier)
// WHERE review_status <> 'rejected'. Safer than `drizzle-kit push`
// which would also try to apply unrelated schema-vs-DB drift.
//
// Prereq: both dedupe scripts must have run against prod first.
// This script verifies that prerequisite before creating the index.
//
// Run: npx tsx scripts/apply-migration-0012.ts
//      npx tsx scripts/apply-migration-0012.ts --dry-run

import { sql } from "drizzle-orm";
import { db } from "../db/client";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Pre-check 1: does the index already exist?
  const existing = await db.execute<{ indexname: string }>(sql`
    SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'data_source'
       AND indexname = 'data_source_shul_identifier_idx'
  `);
  if (existing.rows.length > 0) {
    console.log("Index data_source_shul_identifier_idx already exists. Nothing to do.");
    process.exit(0);
  }

  // Pre-check 2: confirm no duplicate (shul_id, identifier) pairs exist
  // among non-rejected rows. If any exist, the CREATE UNIQUE INDEX will
  // fail — better to fail loudly here with a clear message than to let
  // Postgres throw a generic constraint-violation.
  const dups = await db.execute<{ shul_id: number; identifier: string; n: number }>(sql`
    SELECT shul_id, identifier, COUNT(*)::int AS n
      FROM data_source
     WHERE review_status <> 'rejected'
     GROUP BY shul_id, identifier
    HAVING COUNT(*) > 1
  `);
  if (dups.rows.length > 0) {
    console.error(
      `\nPRECONDITION FAILED: ${dups.rows.length} duplicate (shul_id, identifier) tuple(s) ` +
        `still present among non-rejected rows. Run the dedupe scripts first:\n` +
        `  npx tsx scripts/dedupe-data-sources.ts\n` +
        `  npx tsx scripts/dedupe-cross-status.ts\n\nOffenders:`,
    );
    for (const r of dups.rows) {
      console.error(`  shul ${r.shul_id} / ${r.identifier} (n=${r.n})`);
    }
    process.exit(1);
  }
  console.log("Pre-check OK: no duplicate (shul_id, identifier) tuples among non-rejected rows.");

  if (dryRun) {
    console.log("\n[dry-run] Would create partial UNIQUE INDEX:");
    console.log(
      `  CREATE UNIQUE INDEX "data_source_shul_identifier_idx"\n` +
        `    ON "data_source" ("shul_id", "identifier")\n` +
        `    WHERE "review_status" <> 'rejected';`,
    );
    process.exit(0);
  }

  console.log("\nCreating partial UNIQUE INDEX ...");
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "data_source_shul_identifier_idx"
      ON "data_source" ("shul_id", "identifier")
      WHERE "review_status" <> 'rejected'
  `);
  console.log("  done.");

  // Post-check: confirm the index exists with the expected predicate.
  const after = await db.execute<{ indexname: string; indexdef: string }>(sql`
    SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'data_source'
       AND indexname = 'data_source_shul_identifier_idx'
  `);
  console.log("\nFinal index state:");
  for (const r of after.rows) {
    console.log(`  ${r.indexname}`);
    console.log(`    ${r.indexdef}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
