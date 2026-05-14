// Re-scrape an existing data_source. Fetches the page, compares its
// content hash to the last-known hash on the data_source row, and:
//   - unchanged → write a scrape_run row marked `no_change`, done
//   - changed → re-extract via LLM, soft-delete old rules, insert new,
//               update data_source.config_json + last_run_*
//   - "broken" (low confidence OR >50% rule-count drop) → write a
//               scrape_run row marked `broken`, flip data_source.review_status
//               back to `pending`, leave rules untouched
//
// Always writes exactly one scrape_run row.

import { and, eq, isNull, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import { dataSource, minyanRule, scrapeRun, shul } from "../../../db/schema";
import { fetchHtml } from "../../scrapers/fetch";
import { extractFromHtml } from "../../llm/extract";
import { runCascade } from "../../llm/cascade";
import { evaluateExtractionGuardrails } from "../../pipeline/guardrails";
import { insertRuleFromExtraction } from "../../pipeline/persist-submission";

export const scrapeOneShul = inngest.createFunction(
  {
    id: "shul-scrape-one",
    concurrency: {
      // Best-effort per-host limit. The event payload doesn't carry the
      // host directly; we use shulId as a proxy (one shul = one host).
      key: "event.data.shulId",
      limit: 1,
    },
    triggers: [{ event: "shul.scrape.requested" }],
  },
  async ({ event, step }) => {
    const { shulId, dataSourceId, reason } = event.data as {
      shulId: number;
      dataSourceId: number;
      reason: "weekly" | "manual";
    };

    if (process.env.SCRAPE_ENABLED === "false") {
      return { skipped: true, reason: "SCRAPE_ENABLED=false" };
    }

    // ─── 1. Load the data_source row + parent shul status ────────
    const loaded = await step.run("load-data-source", async () => {
      const rows = await db
        .select({
          id: dataSource.id,
          identifier: dataSource.identifier,
          kind: dataSource.kind,
          configJson: dataSource.configJson,
          extractionStrategy: dataSource.extractionStrategy,
          shulStatus: shul.status,
        })
        .from(dataSource)
        .innerJoin(shul, eq(shul.id, dataSource.shulId))
        .where(eq(dataSource.id, dataSourceId))
        .limit(1);
      if (!rows[0]) throw new Error(`data_source ${dataSourceId} not found`);
      return rows[0];
    });

    // ─── 1a. Skip failed / unsupported sources ──────────────────
    // If the previous extraction couldn't get rules out of this site
    // through any tier of the cascade, don't waste resources retrying.
    // Admin must manually re-trigger.
    if (
      loaded.extractionStrategy === "failed" ||
      loaded.shulStatus === "unsupported"
    ) {
      await db.insert(scrapeRun).values({
        shulId,
        dataSourceId,
        startedAt: new Date(),
        finishedAt: new Date(),
        status: "no_change",
        rulesAdded: 0,
        rulesRemoved: 0,
        rulesChanged: 0,
        error: "skipped: data_source marked failed / shul unsupported",
      });
      return { skipped: true, reason: "unsupported" };
    }

    // NULL `extractionStrategy` happens for pre-cascade rows that
    // existed before migration 0003 ran but weren't backfilled
    // (e.g. email_newsletter kind, or any legacy row we missed).
    // Treat NULL as HTML — the original sprint-1 extractors all
    // worked on HTML, so falling into the HTML path below is safe.
    const strategy = loaded.extractionStrategy ?? "html";

    // ─── 1b. Non-HTML strategies: rerun the cascade pinned to it ─
    // The HTML-specific flow below has hash optimization + drop
    // detection tuned for HTML; for JS-rendered, PDF, vision sources
    // we just rerun the cascade with the stored strategy and apply
    // the result without the hash shortcut.
    if (
      strategy === "js_rendered" ||
      strategy === "pdf_document" ||
      strategy === "vision_image"
    ) {
      return rescrapeNonHtml({
        shulId,
        dataSourceId,
        identifier: loaded.identifier,
        strategy: strategy as "js_rendered" | "pdf_document" | "vision_image",
        previousConfig: loaded.configJson as object | null,
      });
    }

    const url = loaded.identifier;
    const previousHash =
      (loaded.configJson as { page_content_hash?: string } | null)?.page_content_hash ?? null;

    // ─── 2. Fetch page ──────────────────────────────────────────
    const fetched = await step.run("fetch", async () => {
      const res = await fetchHtml(url, { timeoutMs: 20_000 });
      if (!res.ok) {
        throw new Error(`Fetch failed: HTTP ${res.status} for ${url}`);
      }
      return { html: res.html, finalUrl: res.finalUrl, status: res.status };
    });

    // ─── 3. Quick path: extractor will hash & compare ──────────
    // We let extractFromHtml() compute the hash so we have a single
    // source of truth for it. But if the hash matches the last run, we
    // skip the LLM entirely.
    const newHashOnly = await step.run("hash-check", async () => {
      const { createHash } = await import("node:crypto");
      const truncated = fetched.html.slice(0, 80_000);
      return createHash("sha256").update(truncated, "utf8").digest("hex");
    });

    if (previousHash && newHashOnly === previousHash) {
      // No change since last scrape — write the audit row and stop.
      await step.run("write-scrape-run-no-change", async () => {
        await db.insert(scrapeRun).values({
          shulId,
          dataSourceId,
          startedAt: new Date(),
          finishedAt: new Date(),
          status: "no_change",
          rulesAdded: 0,
          rulesRemoved: 0,
          rulesChanged: 0,
        });
        await db
          .update(dataSource)
          .set({ lastRunAt: new Date(), lastRunStatus: "no_change", updatedAt: new Date() })
          .where(eq(dataSource.id, dataSourceId));
      });
      return { changed: false, reason, hash: newHashOnly };
    }

    // ─── 4. Hash differs — re-extract ────────────────────────────
    const extracted = await step.run("llm-extract", async () => {
      return extractFromHtml(fetched.html);
    });

    // ─── 5. Decide: auto-apply, or flag as broken? ──────────────
    const prevCount = await step.run("count-existing-rules", async () => {
      const rows = await db
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(minyanRule)
        .where(
          and(eq(minyanRule.dataSourceId, dataSourceId), isNull(minyanRule.deletedAt)),
        );
      return rows[0]?.n ?? 0;
    });

    const newCount = extracted.extraction.rules.length;
    const verdict = evaluateExtractionGuardrails({
      prevRuleCount: prevCount,
      newRuleCount: newCount,
      newConfidence: extracted.extraction.confidence,
    });

    if (verdict.shouldFlagBroken) {
      // Don't auto-apply. Mark broken, flag for review, keep old rules
      // in place so daveners see the previous schedule until reviewed.
      await step.run("mark-broken", async () => {
        await db.insert(scrapeRun).values({
          shulId,
          dataSourceId,
          startedAt: new Date(),
          finishedAt: new Date(),
          status: "broken",
          rulesAdded: 0,
          rulesRemoved: 0,
          rulesChanged: 0,
          error: verdict.reason ?? "broken",
        });
        await db
          .update(dataSource)
          .set({
            lastRunAt: new Date(),
            lastRunStatus: "broken",
            reviewStatus: "pending",
            confidenceScore: extracted.extraction.confidence,
            updatedAt: new Date(),
            // store the rejected proposal in config_json for the reviewer to inspect
            configJson: {
              ...(loaded.configJson as object | null ?? {}),
              last_rejected_extraction: {
                at: new Date().toISOString(),
                model: extracted.model,
                page_content_hash: extracted.pageContentHash,
                confidence: extracted.extraction.confidence,
                reasoning: extracted.extraction.reasoning,
                rules_count: newCount,
                previous_rules_count: prevCount,
              },
            },
          })
          .where(eq(dataSource.id, dataSourceId));
      });
      return {
        changed: false,
        broken: true,
        prevCount,
        newCount,
        confidence: extracted.extraction.confidence,
      };
    }

    // ─── 6. Apply changes: soft-delete old rules, insert new ─────
    const applied = await step.run("apply-changes", async () => {
      const now = new Date();

      // Soft-delete every currently-live rule linked to this data_source
      const deleted = await db
        .update(minyanRule)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(eq(minyanRule.dataSourceId, dataSourceId), isNull(minyanRule.deletedAt)),
        )
        .returning({ id: minyanRule.id });

      // Insert the new rules
      let inserted = 0;
      for (const r of extracted.extraction.rules) {
        await insertRuleFromExtraction(db, {
          shulId,
          dataSourceId,
          rule: r,
          lastSeenAt: now,
        });
        inserted++;
      }

      // Refresh data_source: new hash, new confidence, last_run timestamps
      await db
        .update(dataSource)
        .set({
          lastRunAt: now,
          lastRunStatus: "ok",
          confidenceScore: extracted.extraction.confidence,
          builtAt: now,
          builtBy: "llm",
          configJson: {
            ...(loaded.configJson as object | null ?? {}),
            version: 1,
            page_url: url,
            final_url: fetched.finalUrl,
            fetched_status: fetched.status,
            page_content_hash: extracted.pageContentHash,
            model: extracted.model,
            prompt_version: "tfila-v1",
            extracted_at: now.toISOString(),
            reasoning: extracted.extraction.reasoning,
            usage: extracted.usage,
            last_rejected_extraction: undefined, // clear any prior broken-flag context
          },
          updatedAt: now,
        })
        .where(eq(dataSource.id, dataSourceId));

      // Audit row
      await db.insert(scrapeRun).values({
        shulId,
        dataSourceId,
        startedAt: now,
        finishedAt: new Date(),
        status: "ok",
        rulesAdded: inserted,
        rulesRemoved: deleted.length,
        rulesChanged: 0, // we do replace-all, not in-place change tracking
      });

      return { rulesAdded: inserted, rulesRemoved: deleted.length };
    });

    return {
      changed: true,
      reason,
      hash: extracted.pageContentHash,
      confidence: extracted.extraction.confidence,
      model: extracted.model,
      ...applied,
    };
  },
);

/**
 * Re-scrape path for non-HTML strategies (js_rendered, pdf_document,
 * vision_image). Reruns the cascade pinned to the stored strategy so
 * we don't pay for earlier tiers. Applies the same broken-flag and
 * soft-delete semantics as the HTML path but without the hash check
 * (these tiers don't produce a stable content hash anyway).
 */
async function rescrapeNonHtml(args: {
  shulId: number;
  dataSourceId: number;
  identifier: string;
  strategy: "js_rendered" | "pdf_document" | "vision_image";
  previousConfig: object | null;
}): Promise<{
  changed: boolean;
  broken?: boolean;
  rulesAdded?: number;
  rulesRemoved?: number;
  confidence?: number;
  strategy: string;
}> {
  // The submitted URL is what the cascade needs — for non-HTML strategies
  // we stored the resource URL (PDF/image) as the identifier. Walk up to
  // the original submitted_url from configJson so the cascade re-discovers
  // the resource via its rediscovery logic (PDF link search, etc).
  const submittedUrl =
    (args.previousConfig as { submitted_url?: string } | null)?.submitted_url ??
    args.identifier;

  const cascade = await runCascade(submittedUrl, {
    timeoutMs: 25_000,
    preferredStrategy: args.strategy,
  });

  if (cascade.strategy === "failed" || !cascade.extraction) {
    await db.insert(scrapeRun).values({
      shulId: args.shulId,
      dataSourceId: args.dataSourceId,
      startedAt: new Date(),
      finishedAt: new Date(),
      status: "broken",
      rulesAdded: 0,
      rulesRemoved: 0,
      rulesChanged: 0,
      error: `cascade re-run failed for strategy ${args.strategy}`,
    });
    return { changed: false, broken: true, strategy: args.strategy };
  }

  const prevCount = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(minyanRule)
    .where(
      and(
        eq(minyanRule.dataSourceId, args.dataSourceId),
        isNull(minyanRule.deletedAt),
      ),
    )
    .then((rows) => rows[0]?.n ?? 0);

  const newCount = cascade.extraction.rules.length;
  const verdict = evaluateExtractionGuardrails({
    prevRuleCount: prevCount,
    newRuleCount: newCount,
    newConfidence: cascade.extraction.confidence,
  });

  if (verdict.shouldFlagBroken) {
    await db.insert(scrapeRun).values({
      shulId: args.shulId,
      dataSourceId: args.dataSourceId,
      startedAt: new Date(),
      finishedAt: new Date(),
      status: "broken",
      rulesAdded: 0,
      rulesRemoved: 0,
      rulesChanged: 0,
      error: verdict.reason ?? "broken",
    });
    await db
      .update(dataSource)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: "broken",
        reviewStatus: "pending",
        confidenceScore: cascade.extraction.confidence,
        updatedAt: new Date(),
      })
      .where(eq(dataSource.id, args.dataSourceId));
    return {
      changed: false,
      broken: true,
      strategy: args.strategy,
      confidence: cascade.extraction.confidence,
    };
  }

  // Apply: soft-delete old, insert new
  const now = new Date();
  const deleted = await db
    .update(minyanRule)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(minyanRule.dataSourceId, args.dataSourceId),
        isNull(minyanRule.deletedAt),
      ),
    )
    .returning({ id: minyanRule.id });

  let inserted = 0;
  for (const r of cascade.extraction.rules) {
    await insertRuleFromExtraction(db, {
      shulId: args.shulId,
      dataSourceId: args.dataSourceId,
      rule: r,
      lastSeenAt: now,
    });
    inserted++;
  }

  await db
    .update(dataSource)
    .set({
      // Keep identifier on the page URL so next week's rescrape still
      // re-targets the page (and re-discovers the new week's resource).
      // The specific image/PDF URL goes to configJson.last_extracted_resource.
      identifier: submittedUrl,
      lastRunAt: now,
      lastRunStatus: "ok",
      confidenceScore: cascade.extraction.confidence,
      builtAt: now,
      builtBy: "llm",
      configJson: {
        ...(args.previousConfig ?? {}),
        version: 2,
        page_url: submittedUrl,
        submitted_url: submittedUrl,
        extraction_strategy: cascade.strategy,
        last_extracted_resource: cascade.winningUrl,
        cascade_attempts: cascade.attempts,
        model: cascade.model,
        prompt_version: "tfila-v1",
        extracted_at: now.toISOString(),
        reasoning: cascade.extraction.reasoning,
        usage: cascade.usage,
      },
      updatedAt: now,
    })
    .where(eq(dataSource.id, args.dataSourceId));

  await db.insert(scrapeRun).values({
    shulId: args.shulId,
    dataSourceId: args.dataSourceId,
    startedAt: now,
    finishedAt: new Date(),
    status: "ok",
    rulesAdded: inserted,
    rulesRemoved: deleted.length,
    rulesChanged: 0,
  });

  return {
    changed: true,
    rulesAdded: inserted,
    rulesRemoved: deleted.length,
    confidence: cascade.extraction.confidence,
    strategy: args.strategy,
  };
}
