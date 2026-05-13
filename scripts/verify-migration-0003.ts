// One-shot verification that migration 0003 (extraction_strategy)
// has been applied. Run with: npx tsx scripts/verify-migration-0003.ts
//
// Checks:
//   - 'extraction_strategy' enum exists with all 5 values
//   - data_source.extraction_strategy column exists, correct type
//   - 'unsupported' is in shul_status enum
//   - existing data_source rows have been backfilled to 'html'

import { sql } from "drizzle-orm";
import { db } from "../db/client";

async function main() {
  let ok = true;
  function check(label: string, pass: boolean, detail?: string) {
    console.log(`${pass ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
    if (!pass) ok = false;
  }

  // 1. extraction_strategy enum exists, has all 5 values
  const enumValues = await db.execute<{ enumlabel: string }>(sql`
    SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
     WHERE t.typname = 'extraction_strategy'
     ORDER BY e.enumsortorder
  `);
  const got = enumValues.rows.map((r) => r.enumlabel);
  const expected = ["html", "js_rendered", "pdf_document", "vision_image", "failed"];
  check(
    "extraction_strategy enum exists with 5 values",
    expected.every((v) => got.includes(v)) && got.length === 5,
    `got: [${got.join(", ")}]`,
  );

  // 2. data_source.extraction_strategy column exists
  const col = await db.execute<{ data_type: string; udt_name: string }>(sql`
    SELECT data_type, udt_name
      FROM information_schema.columns
     WHERE table_name = 'data_source'
       AND column_name = 'extraction_strategy'
  `);
  check(
    "data_source.extraction_strategy column exists",
    col.rows.length === 1 && col.rows[0].udt_name === "extraction_strategy",
    col.rows[0]
      ? `data_type=${col.rows[0].data_type}, udt_name=${col.rows[0].udt_name}`
      : "(column not found)",
  );

  // 3. shul_status has 'unsupported'
  const shulStatusVals = await db.execute<{ enumlabel: string }>(sql`
    SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
     WHERE t.typname = 'shul_status'
     ORDER BY e.enumsortorder
  `);
  const statusGot = shulStatusVals.rows.map((r) => r.enumlabel);
  check(
    "shul_status enum includes 'unsupported'",
    statusGot.includes("unsupported"),
    `values: [${statusGot.join(", ")}]`,
  );

  // 4. Backfill: every existing website_llm/shulcloud_website data_source
  //    should now have extraction_strategy = 'html'
  const backfill = await db.execute<{
    total: string;
    backfilled: string;
    null_count: string;
  }>(sql`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE extraction_strategy = 'html')::text AS backfilled,
      COUNT(*) FILTER (WHERE extraction_strategy IS NULL)::text AS null_count
      FROM data_source
     WHERE kind IN ('website_llm', 'shulcloud_website')
  `);
  const b = backfill.rows[0];
  check(
    "existing website data_source rows backfilled to 'html'",
    Number(b.null_count) === 0,
    `total=${b.total}, backfilled=${b.backfilled}, still null=${b.null_count}`,
  );

  console.log("");
  console.log(ok ? "✅ Migration 0003 verified." : "❌ Migration 0003 incomplete — see ✗ above.");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
