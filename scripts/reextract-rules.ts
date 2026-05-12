// For each shul that has a location + a submitted URL, re-run the LLM
// extractor and replace the sprint-1 rules with fresh LLM-extracted ones.
// Sprint-1's heuristic extractor produced fixed-clock times that don't
// reflect zmanim-relative semantics; this gives us a one-shot upgrade.
//
//   npx tsx scripts/reextract-rules.ts [--dry-run] [--limit=N] [--shul=slug]

import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { dataSource, minyanRule, shul, type MinyanTime } from "../db/schema";
import { fetchHtml } from "../lib/scrapers/fetch";
import { extractFromHtml } from "../lib/llm/extract";

const MIN_REPLACE_CONFIDENCE = 0.5;

async function main() {
  const limitFlag = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitFlag ? parseInt(limitFlag.split("=")[1], 10) : Infinity;
  const dryRun = process.argv.includes("--dry-run");
  const shulFlag = process.argv.find((a) => a.startsWith("--shul="));
  const slug = shulFlag ? shulFlag.split("=")[1] : null;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required.");
    process.exit(2);
  }

  // Pick eligible shuls
  let rows;
  if (slug) {
    rows = await db
      .select({ id: shul.id, slug: shul.slug, submittedUrl: shul.submittedUrl })
      .from(shul)
      .where(eq(shul.slug, slug));
  } else {
    rows = await db
      .select({ id: shul.id, slug: shul.slug, submittedUrl: shul.submittedUrl })
      .from(shul)
      .where(eq(shul.status, "active"));
  }
  rows = rows.filter((r) => r.submittedUrl).slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(`${rows.length} shul(s) to re-extract${dryRun ? " (DRY RUN)" : ""}\n`);

  let updated = 0;
  let skipped = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    const prefix = `[${(i + 1).toString().padStart(2)}/${rows.length}] ${s.slug.padEnd(40).slice(0, 40)}`;

    // Fetch the submitted_url (usually /calendar for ShulCloud sites)
    let html: string;
    try {
      const fetched = await fetchHtml(s.submittedUrl!, { timeoutMs: 20_000 });
      if (!fetched.ok || !fetched.html) {
        console.log(`${prefix}  ✗ fetch HTTP ${fetched.status}`);
        skipped++;
        continue;
      }
      html = fetched.html;
    } catch (err) {
      console.log(`${prefix}  ✗ fetch error: ${(err as Error).message.slice(0, 60)}`);
      skipped++;
      continue;
    }

    // LLM-extract
    let extracted;
    try {
      extracted = await extractFromHtml(html);
    } catch (err) {
      console.log(`${prefix}  ✗ LLM error: ${(err as Error).message.slice(0, 80)}`);
      skipped++;
      continue;
    }
    totalInputTokens += extracted.usage.haiku.inputTokens + (extracted.usage.sonnet?.inputTokens ?? 0);
    totalOutputTokens += extracted.usage.haiku.outputTokens + (extracted.usage.sonnet?.outputTokens ?? 0);

    if (
      extracted.extraction.rules.length === 0 ||
      extracted.extraction.confidence < MIN_REPLACE_CONFIDENCE
    ) {
      console.log(
        `${prefix}  ⊘ skip (conf=${extracted.extraction.confidence.toFixed(2)}, rules=${extracted.extraction.rules.length})`,
      );
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(
        `${prefix}  → would replace with ${extracted.extraction.rules.length} rules (conf=${extracted.extraction.confidence.toFixed(2)}, ${extracted.model})`,
      );
      updated++;
      continue;
    }

    // Persist: find or create the data_source for this shul, then
    // soft-delete its existing rules and insert fresh ones.
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: dataSource.id, configJson: dataSource.configJson })
        .from(dataSource)
        .where(eq(dataSource.shulId, s.id))
        .limit(1);

      const now = new Date();
      const newConfig = {
        version: 1,
        page_url: s.submittedUrl,
        page_content_hash: extracted.pageContentHash,
        model: extracted.model,
        prompt_version: "tfila-v1",
        extracted_at: now.toISOString(),
        reasoning: extracted.extraction.reasoning,
        usage: extracted.usage,
      };

      let dataSourceId: number;
      if (existing[0]) {
        dataSourceId = existing[0].id;
        // soft-delete existing rules
        await tx
          .update(minyanRule)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(eq(minyanRule.dataSourceId, dataSourceId), isNull(minyanRule.deletedAt)),
          );
        // upgrade kind + config
        await tx
          .update(dataSource)
          .set({
            kind: "website_llm",
            configJson: newConfig,
            confidenceScore: extracted.extraction.confidence,
            builtAt: now,
            builtBy: "llm",
            lastRunAt: now,
            lastRunStatus: "ok",
            reviewStatus: "approved", // skip queue: we're authoritatively replacing
            updatedAt: now,
            priority: 50,
          })
          .where(eq(dataSource.id, dataSourceId));
      } else {
        const [inserted] = await tx
          .insert(dataSource)
          .values({
            shulId: s.id,
            kind: "website_llm",
            identifier: s.submittedUrl!,
            configJson: newConfig,
            confidenceScore: extracted.extraction.confidence,
            priority: 50,
            builtAt: now,
            builtBy: "llm",
            lastRunAt: now,
            lastRunStatus: "ok",
            reviewStatus: "approved",
          })
          .returning({ id: dataSource.id });
        dataSourceId = inserted.id;
      }

      for (const r of extracted.extraction.rules) {
        const time: MinyanTime =
          r.time.kind === "fixed"
            ? { kind: "fixed", clock: r.time.clock }
            : { kind: "zmanim", anchor: r.time.anchor, offsetMin: r.time.offsetMin };
        await tx.insert(minyanRule).values({
          shulId: s.id,
          dataSourceId,
          tefillah: r.tefillah,
          tefillahLabel: r.tefillahLabel ?? null,
          daysOfWeek: r.daysOfWeek ?? null,
          time: time as unknown as object,
          validFrom: r.validFrom ?? null,
          validTo: r.validTo ?? null,
          specialScheduleKind: r.specialScheduleKind,
          priority: 0,
          nusach: r.nusach ?? null,
          notes: r.notes ?? null,
          lastSeenInScrapeAt: now,
        });
      }
    });

    console.log(
      `${prefix}  ✓ ${extracted.extraction.rules.length} rules (conf=${extracted.extraction.confidence.toFixed(2)}, ${extracted.model})`,
    );
    updated++;
  }

  console.log(`\n──────── Summary ────────`);
  console.log(`Updated  : ${updated}`);
  console.log(`Skipped  : ${skipped}`);
  console.log(`Tokens   : in=${totalInputTokens.toLocaleString()}  out=${totalOutputTokens.toLocaleString()}`);
  const estCost =
    (totalInputTokens * 1) / 1_000_000 + (totalOutputTokens * 5) / 1_000_000; // Haiku rates dominate
  console.log(`Est cost : ~$${estCost.toFixed(4)} (Haiku-dominated)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
