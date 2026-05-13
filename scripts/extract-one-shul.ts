// One-off: extract minyan rules for a single shul by ID. Used when
// Inngest isn't synced yet but we want to process a pending submission.
//
//   npx tsx scripts/extract-one-shul.ts <shulId>

import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  shul,
  dataSource,
  minyanRule,
  serializeMinyanTime,
  type MinyanTime,
} from "../db/schema";
import { fetchHtml } from "../lib/scrapers/fetch";
import { extractFromHtml } from "../lib/llm/extract";

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id)) {
    console.error("Usage: npx tsx scripts/extract-one-shul.ts <shulId>");
    process.exit(2);
  }

  const rows = await db.select().from(shul).where(eq(shul.id, id)).limit(1);
  const s = rows[0];
  if (!s) {
    console.error(`shul ${id} not found`);
    process.exit(1);
  }
  if (!s.submittedUrl) {
    console.error(`shul ${id} has no submitted_url`);
    process.exit(1);
  }
  console.log(`Processing shul ${id}: ${s.slug} (${s.submittedUrl})`);

  const fetched = await fetchHtml(s.submittedUrl, { timeoutMs: 20_000 });
  if (!fetched.ok) {
    console.error(`fetch failed: HTTP ${fetched.status}`);
    process.exit(1);
  }
  console.log(`  Fetched ${fetched.html.length} chars`);

  const ex = await extractFromHtml(fetched.html);
  console.log(
    `  Extraction: confidence=${ex.extraction.confidence.toFixed(2)} rules=${ex.extraction.rules.length} model=${ex.model}`,
  );

  await db.transaction(async (tx) => {
    const [ds] = await tx
      .insert(dataSource)
      .values({
        shulId: id,
        kind: "website_llm",
        identifier: s.submittedUrl!,
        configJson: {
          version: 1,
          page_url: s.submittedUrl,
          page_content_hash: ex.pageContentHash,
          model: ex.model,
          prompt_version: "tfila-v1",
          extracted_at: new Date().toISOString(),
          reasoning: ex.extraction.reasoning,
          usage: ex.usage,
        },
        confidenceScore: ex.extraction.confidence,
        priority: 40,
        builtBy: "llm",
        builtAt: new Date(),
        lastRunAt: new Date(),
        lastRunStatus: "ok",
        reviewStatus: "pending",
      })
      .returning({ id: dataSource.id });

    for (const r of ex.extraction.rules) {
      const time: MinyanTime =
        r.time.kind === "fixed"
          ? { kind: "fixed", clock: r.time.clock }
          : { kind: "zmanim", anchor: r.time.anchor, offsetMin: r.time.offsetMin };
      await tx.insert(minyanRule).values({
        shulId: id,
        dataSourceId: ds.id,
        tefillah: r.tefillah,
        tefillahLabel: r.tefillahLabel ?? null,
        daysOfWeek: r.daysOfWeek ?? null,
        time: serializeMinyanTime(time),
        validFrom: r.validFrom ?? null,
        validTo: r.validTo ?? null,
        specialScheduleKind: r.specialScheduleKind,
        priority: 0,
        nusach: r.nusach ?? null,
        notes: r.notes ?? null,
        lastSeenInScrapeAt: new Date(),
      });
    }

    if (ex.extraction.shulAddress) {
      await tx.execute(sql`
        UPDATE shul SET address = COALESCE(address, ${ex.extraction.shulAddress}), updated_at = NOW() WHERE id = ${id}
      `);
    }
    if (ex.extraction.shulName) {
      await tx.execute(sql`
        UPDATE shul SET name = ${ex.extraction.shulName}, updated_at = NOW() WHERE id = ${id} AND name LIKE '%.%'
      `);
    }
  });

  console.log(`✓ Data source + ${ex.extraction.rules.length} rules persisted. Visit /admin/queue to review.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
