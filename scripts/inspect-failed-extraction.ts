// Inspect the most recent failed extraction for a given shul URL.
// Run: npx tsx scripts/inspect-failed-extraction.ts <substring-of-url>
//
// Example: npx tsx scripts/inspect-failed-extraction.ts theshul.org

import { sql } from "drizzle-orm";
import { db } from "../db/client";

async function main() {
  const needle = process.argv[2];
  if (!needle) {
    console.error("Usage: tsx scripts/inspect-failed-extraction.ts <url-substring>");
    process.exit(1);
  }

  const rows = await db.execute<{
    id: number;
    shul_id: number;
    shul_name: string;
    shul_status: string;
    submitted_url: string | null;
    identifier: string;
    extraction_strategy: string | null;
    confidence_score: number | null;
    config_json: unknown;
    built_at: string | null;
  }>(sql`
    SELECT
      ds.id,
      ds.shul_id,
      s.name AS shul_name,
      s.status AS shul_status,
      s.submitted_url,
      ds.identifier,
      ds.extraction_strategy,
      ds.confidence_score,
      ds.config_json,
      ds.built_at
    FROM data_source ds
    JOIN shul s ON s.id = ds.shul_id
    WHERE s.submitted_url ILIKE ${`%${needle}%`}
       OR ds.identifier ILIKE ${`%${needle}%`}
       OR s.name ILIKE ${`%${needle}%`}
    ORDER BY ds.built_at DESC NULLS LAST
    LIMIT 5
  `);

  if (rows.rows.length === 0) {
    console.log(`No data_source rows matching "${needle}"`);
    process.exit(0);
  }

  for (const r of rows.rows) {
    console.log("─".repeat(80));
    console.log(`Shul: ${r.shul_name}  (id ${r.shul_id})  status=${r.shul_status}`);
    console.log(`Data source: id=${r.id}  strategy=${r.extraction_strategy}  conf=${r.confidence_score ?? "—"}`);
    console.log(`Built: ${r.built_at}`);
    console.log(`Submitted URL: ${r.submitted_url}`);
    console.log(`Identifier:    ${r.identifier}`);
    console.log("");
    const cfg = (r.config_json ?? {}) as Record<string, unknown>;
    const attempts = cfg.cascade_attempts as
      | Array<Record<string, unknown>>
      | undefined;
    if (!attempts) {
      console.log("(No cascade_attempts in configJson — may be a legacy data_source)");
      console.log("configJson keys:", Object.keys(cfg));
    } else {
      console.log(`Cascade attempts (${attempts.length}):`);
      for (const [i, a] of attempts.entries()) {
        console.log(
          `  [${i + 1}] strategy=${a.strategy} status=${a.status} rules=${a.rulesCount} conf=${a.confidence ?? "—"}`,
        );
        if (a.resourceUrl) console.log(`       url:   ${a.resourceUrl}`);
        if (a.httpStatus !== undefined) console.log(`       http:  ${a.httpStatus}`);
        if (a.errorMessage) console.log(`       error: ${a.errorMessage}`);
      }
    }
    if (cfg.reasoning)
      console.log("\nFinal reasoning:", String(cfg.reasoning).slice(0, 400));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("inspect failed:", err);
  process.exit(1);
});
