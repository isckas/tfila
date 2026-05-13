// Backfill: for any data_source with extractionStrategy in
// (vision_image, pdf_document), move the resource URL from `identifier`
// to `config_json.last_extracted_resource` and set `identifier` to the
// page URL stored in `config_json.submitted_url`. Idempotent.
//
// Run: npx tsx scripts/backfill-resource-identifier.ts

import { sql } from "drizzle-orm";
import { db } from "../db/client";

interface Row extends Record<string, unknown> {
  id: number;
  shul_id: number;
  identifier: string;
  extraction_strategy: string;
  config_json: {
    submitted_url?: string;
    page_url?: string;
    last_extracted_resource?: string;
  } | null;
}

async function main() {
  const rows = await db.execute<Row>(sql`
    SELECT id, shul_id, identifier, extraction_strategy, config_json
      FROM data_source
     WHERE extraction_strategy IN ('vision_image', 'pdf_document')
       AND (
         (config_json->>'last_extracted_resource') IS NULL
         OR identifier <> COALESCE(config_json->>'submitted_url', identifier)
       )
  `);

  if (rows.rows.length === 0) {
    console.log("Nothing to backfill.");
    process.exit(0);
  }

  console.log(`Found ${rows.rows.length} data_source row(s) to backfill:`);
  for (const r of rows.rows) {
    const cfg = r.config_json ?? {};
    const pageUrl = cfg.submitted_url ?? cfg.page_url;
    if (!pageUrl) {
      console.log(`  ds ${r.id}: SKIP — no submitted_url in configJson`);
      continue;
    }
    console.log(`  ds ${r.id}: ${r.extraction_strategy}`);
    console.log(`    old identifier: ${r.identifier}`);
    console.log(`    new identifier: ${pageUrl}`);
    console.log(`    resource → configJson.last_extracted_resource`);
    const newCfg = {
      ...cfg,
      page_url: pageUrl,
      last_extracted_resource:
        cfg.last_extracted_resource ?? r.identifier,
    };
    await db.execute(sql`
      UPDATE data_source
         SET identifier = ${pageUrl},
             config_json = ${JSON.stringify(newCfg)}::jsonb,
             updated_at = NOW()
       WHERE id = ${r.id}
    `);
  }
  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
