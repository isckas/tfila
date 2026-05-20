// Re-scrape an existing data_source. Fetches the page, compares its
// content hash to the last-known hash on the data_source row, and:
//   - unchanged → write a scrape_run row marked `no_change`, done
//   - changed → re-extract via LLM, soft-delete old rules, insert new,
//               update data_source.config_json + last_run_*
//   - "broken" (low confidence OR >50% rule-count drop) → write a
//               scrape_run row marked `broken`, flip data_source.review_status
//               back to `pending`, leave rules untouched
//
// Writes one scrape_run row per attempt, EXCEPT on the early-bail
// skip path (Fix F) where the source is already `strategy='failed'`
// or the shul is `unsupported` — those skip writes entirely so they
// don't pollute the cron-summary's no_change/error tallies.

import { and, eq, isNull, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import { dataSource, minyanRule, scrapeRun, shul } from "../../../db/schema";
import { fetchHtml } from "../../scrapers/fetch";
import { hashSanitizedHtml } from "../../llm/extract";
import { runCascade } from "../../llm/cascade";
import { evaluateExtractionGuardrails } from "../../pipeline/guardrails";
import { insertRuleFromExtraction } from "../../pipeline/persist-submission";

// Permissive step type — we only use step.run. Avoids the gnarly
// `Parameters<typeof inngest.createFunction>[…]` extraction while
// still letting us pass `step` into helper functions for memoization.
type Step = {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
};

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
          lastRunStatus: dataSource.lastRunStatus,
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
    //
    // Fix F: don't write a scrape_run row at all. The previous design
    // wrote status='no_change' with an error message, which corrupted
    // cron-summary stats by counting skips as healthy no-changes. The
    // data_source row already records its failed state on its own
    // columns (extraction_strategy='failed', last_run_status='broken'),
    // so no audit row is needed for the skip itself.
    if (
      loaded.extractionStrategy === "failed" ||
      loaded.shulStatus === "unsupported"
    ) {
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
      return rescrapeNonHtml(step as Step, {
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

    // ─── 3. Quick path: hash + compare against the last stored hash.
    // Both this hash AND extractFromHtml's stored pageContentHash
    // come from hashSanitizedHtml() — same sanitize + truncate + hash
    // pipeline — so an unchanged page produces the same hash and we
    // skip the LLM entirely. Prior to the shared helper the two
    // hashes diverged (raw vs sanitized) and the optimization never
    // fired, so every weekly cron paid for full extraction.
    const newHashOnly = await step.run("hash-check", async () => {
      return hashSanitizedHtml(fetched.html);
    });

    // Fix I — hash-match short-circuit ONLY when the prior extraction was
    // known-good. If the previous run was broken/error, the hash optimization
    // would lock us into the broken state forever. Force re-extraction so the
    // cascade has a chance to recover (especially important now that Fix H
    // routes HTML rescrape through runCascade with tier fallback).
    const priorWasOk =
      loaded.lastRunStatus === "ok" || loaded.lastRunStatus === "no_change";
    if (previousHash && newHashOnly === previousHash && priorWasOk) {
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

    // ─── 3b. Cost gate — kill switch + daily budget cap. The hash
    // check is free; the LLM call is not. Refuse if either condition
    // trips. Writes a scrape_run row marked `error` so the weekly
    // cron-summary surfaces the bail.
    const gate = await step.run("cost-gate", async () => {
      const { checkCostGate } = await import("../../llm/cost-gate");
      return checkCostGate();
    });
    if (!gate.allowed) {
      const gateMsg =
        gate.reason === "kill_switch"
          ? "extraction disabled via EXTRACTION_DISABLED kill switch"
          : `daily LLM budget exceeded (today $${gate.todayUsd?.toFixed(2)} / cap $${gate.budgetUsd?.toFixed(2)})`;
      await step.run("write-scrape-run-cost-gated", async () => {
        await db.insert(scrapeRun).values({
          shulId,
          dataSourceId,
          startedAt: new Date(),
          finishedAt: new Date(),
          status: "error",
          rulesAdded: 0,
          rulesRemoved: 0,
          rulesChanged: 0,
          error: gateMsg,
        });
        await db
          .update(dataSource)
          .set({ lastRunAt: new Date(), lastRunStatus: "error", updatedAt: new Date() })
          .where(eq(dataSource.id, dataSourceId));
      });
      return { changed: false, reason: "cost-gated", gateReason: gate.reason };
    }

    // ─── 4. Hash differs — re-extract via full cascade ──────────
    // Fix H: route HTML rescrapes through runCascade (not extractFromHtml
    // directly). If the page shape changed and HTML tier now returns 0
    // rules, the cascade falls through to JS-rendered / vision_image /
    // pdf_document. This is the single highest-impact cascade-adaptation
    // fix: it lets the weekly cron recover from shul-page-shape changes
    // without admin intervention.
    const cascade = await step.run("llm-extract", async () => {
      return runCascade(url, {
        preferredStrategy: "html",
        shulId,
        timeoutMs: 25_000,
      });
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

    // Cascade may return strategy='failed' (no tier yielded useful rules).
    // Treat as a broken extraction — same handling as guardrail failure.
    const cascadeFailed = cascade.strategy === "failed" || !cascade.extraction;
    const newCount = cascade.extraction?.rules.length ?? 0;
    const newConfidence = cascade.extraction?.confidence ?? 0;
    const verdict = cascadeFailed
      ? { shouldFlagBroken: true, reason: "cascade exhausted all tiers" }
      : evaluateExtractionGuardrails({
          prevRuleCount: prevCount,
          newRuleCount: newCount,
          newConfidence,
        });

    if (verdict.shouldFlagBroken) {
      // Don't auto-apply. Mark broken, flag for review, keep old rules
      // in place so daveners see the previous schedule until reviewed.
      //
      // Fix Q'/CC: stamp first_broken_at on first broken in streak; demote
      // shul.status from active→pending_review when no other approved+ok
      // source remains for the shul.
      // Wrapped in db.transaction so Inngest retry on partial failure
      // doesn't double-insert the scrape_run audit row. All three writes
      // (run audit, data_source mark-broken, parent-shul demote) are now
      // atomic; on retry, the whole step replays cleanly.
      await step.run("mark-broken", async () => {
        const now = new Date();
        await db.transaction(async (tx) => {
          await tx.insert(scrapeRun).values({
            shulId,
            dataSourceId,
            startedAt: now,
            finishedAt: now,
            status: "broken",
            rulesAdded: 0,
            rulesRemoved: 0,
            rulesChanged: 0,
            error: verdict.reason ?? "broken",
          });
          await tx
            .update(dataSource)
            .set({
              lastRunAt: now,
              lastRunStatus: "broken",
              reviewStatus: "pending",
              confidenceScore: cascade.extraction?.confidence ?? null,
              updatedAt: now,
              // first_broken_at: only set if not already in a broken streak.
              // raw SQL so we can COALESCE the existing value.
              firstBrokenAt: sql`COALESCE(${dataSource.firstBrokenAt}, ${now})` as unknown as Date,
              // store the rejected proposal in config_json for the reviewer to inspect
              configJson: {
                ...(loaded.configJson as object | null ?? {}),
                last_rejected_extraction: {
                  at: now.toISOString(),
                  model: cascade.model,
                  page_content_hash: cascade.pageContentHash,
                  confidence: cascade.extraction?.confidence ?? null,
                  reasoning: cascade.extraction?.reasoning ?? null,
                  cascade_attempts: cascade.attempts,
                  rules_count: newCount,
                  previous_rules_count: prevCount,
                },
              },
            })
            .where(eq(dataSource.id, dataSourceId));

          // Fix CC: active→pending_review demotion. If the parent shul has
          // no other approved+ok+fresh data_source after this run, demote
          // shul.status so admin gets prompted instead of leaving stale
          // rules visible on a "still active" shul.
          await tx.execute(sql`
            UPDATE shul
               SET status = 'pending_review', updated_at = NOW()
             WHERE id = ${shulId}
               AND status = 'active'
               AND NOT EXISTS (
                 SELECT 1 FROM data_source ds2
                  WHERE ds2.shul_id = shul.id
                    AND ds2.id <> ${dataSourceId}
                    AND ds2.review_status = 'approved'
                    AND ds2.last_run_status IN ('ok', 'no_change')
                    AND COALESCE(ds2.last_received_at, ds2.last_run_at) >=
                        NOW() - INTERVAL '14 days'
               )
          `);
        });
      });
      return {
        changed: false,
        broken: true,
        prevCount,
        newCount,
        confidence: cascade.extraction?.confidence ?? 0,
      };
    }

    // ─── 6. Apply changes atomically: soft-delete old + insert new
    // + update data_source + write scrape_run audit. Wrapped in
    // db.transaction so a partial failure mid-loop doesn't leave
    // duplicate rules on Inngest retry (the soft-delete would be a
    // no-op the second time, then the loop would re-insert).
    //
    // Fix EE: soft-delete skips rules with is_manual_edit=true so admin
    // overrides survive across re-extractions.
    // Fix Q': clear firstBrokenAt on transition back to ok.
    // Fix H (continuation): persist the winning cascade.strategy on
    // data_source.extractionStrategy so the next weekly cron routes
    // through the correct tier (e.g. if HTML failed but vision_image
    // succeeded, future cron uses rescrapeNonHtml path).
    const extraction = cascade.extraction!; // guaranteed non-null past the broken-branch above
    const applied = await step.run("apply-changes", async () => {
      const now = new Date();
      return db.transaction(async (tx) => {
        const deleted = await tx
          .update(minyanRule)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(minyanRule.dataSourceId, dataSourceId),
              isNull(minyanRule.deletedAt),
              eq(minyanRule.isManualEdit, false),
            ),
          )
          .returning({ id: minyanRule.id });

        let inserted = 0;
        for (const r of extraction.rules) {
          await insertRuleFromExtraction(tx, {
            shulId,
            dataSourceId,
            rule: r,
            lastSeenAt: now,
          });
          inserted++;
        }

        await tx
          .update(dataSource)
          .set({
            lastRunAt: now,
            lastRunStatus: "ok",
            // Recovery from a broken streak: mark-broken flipped this to
            // 'pending' (lines 269 area). Now that the extraction recovered,
            // restore 'approved' so the source re-qualifies for the public
            // freshness gate (lib/freshness.ts hasFreshDataSourceForShul +
            // the EXISTS clauses in lib/queries.ts), all of which now
            // require review_status='approved' per Fix P. Without this
            // restore, broken→recovered cycles would permanently hide the
            // shul from public surfaces.
            reviewStatus: "approved",
            confidenceScore: extraction.confidence,
            extractionStrategy: cascade.strategy,
            firstBrokenAt: null,
            builtAt: now,
            builtBy: "llm",
            configJson: {
              ...(loaded.configJson as object | null ?? {}),
              version: 2,
              page_url: url,
              final_url: fetched.finalUrl,
              fetched_status: fetched.status,
              page_content_hash: cascade.pageContentHash,
              extraction_strategy: cascade.strategy,
              winning_url: cascade.winningUrl,
              cascade_attempts: cascade.attempts,
              model: cascade.model,
              prompt_version: "tfila-v1",
              extracted_at: now.toISOString(),
              reasoning: extraction.reasoning,
              usage: cascade.usage,
              last_rejected_extraction: undefined,
            },
            updatedAt: now,
          })
          .where(eq(dataSource.id, dataSourceId));

        await tx.insert(scrapeRun).values({
          shulId,
          dataSourceId,
          startedAt: now,
          finishedAt: new Date(),
          status: "ok",
          rulesAdded: inserted,
          rulesRemoved: deleted.length,
          rulesChanged: 0,
        });

        return { rulesAdded: inserted, rulesRemoved: deleted.length };
      });
    });

    return {
      changed: true,
      reason,
      hash: cascade.pageContentHash,
      confidence: extraction.confidence,
      model: cascade.model,
      strategy: cascade.strategy,
      ...applied,
    };
  },
);

/**
 * Re-scrape path for non-HTML strategies (js_rendered, pdf_document,
 * vision_image). Each unit of work is wrapped in step.run so Inngest
 * memoizes results — a transient failure won't replay the cascade
 * (which costs LLM $) or duplicate rule inserts. The apply-changes
 * step is also wrapped in db.transaction for atomic row replacement.
 */
async function rescrapeNonHtml(
  step: Step,
  args: {
    shulId: number;
    dataSourceId: number;
    identifier: string;
    strategy: "js_rendered" | "pdf_document" | "vision_image";
    previousConfig: object | null;
  },
): Promise<{
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

  const cascade = await step.run("cascade-rerun", async () =>
    runCascade(submittedUrl, {
      timeoutMs: 25_000,
      preferredStrategy: args.strategy,
      shulId: args.shulId,
    }),
  );

  if (cascade.strategy === "failed" || !cascade.extraction) {
    await step.run("mark-broken-cascade-failed", async () => {
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.insert(scrapeRun).values({
          shulId: args.shulId,
          dataSourceId: args.dataSourceId,
          startedAt: now,
          finishedAt: now,
          status: "broken",
          rulesAdded: 0,
          rulesRemoved: 0,
          rulesChanged: 0,
          error: `cascade re-run failed for strategy ${args.strategy}`,
        });
        await tx
          .update(dataSource)
          .set({
            lastRunAt: now,
            lastRunStatus: "broken",
            // Match the other two mark-broken sites: bump back to pending
            // review so this row appears in the admin Broken inbox. Without
            // this, the source stays approved+broken and only Fix G/V's
            // "no approved+ok+fresh source" reduction picks it up — but it
            // still pollutes the apparent "approved" count.
            reviewStatus: "pending",
            firstBrokenAt: sql`COALESCE(${dataSource.firstBrokenAt}, ${now})` as unknown as Date,
            updatedAt: now,
          })
          .where(eq(dataSource.id, args.dataSourceId));
        await tx.execute(sql`
          UPDATE shul
             SET status = 'pending_review', updated_at = NOW()
           WHERE id = ${args.shulId}
             AND status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM data_source ds2
                WHERE ds2.shul_id = shul.id
                  AND ds2.id <> ${args.dataSourceId}
                  AND ds2.review_status = 'approved'
                  AND ds2.last_run_status IN ('ok', 'no_change')
                  AND COALESCE(ds2.last_received_at, ds2.last_run_at) >=
                      NOW() - INTERVAL '14 days'
             )
        `);
      });
    });
    return { changed: false, broken: true, strategy: args.strategy };
  }

  const prevCount = await step.run("count-existing-rules", async () =>
    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(minyanRule)
      .where(
        and(
          eq(minyanRule.dataSourceId, args.dataSourceId),
          isNull(minyanRule.deletedAt),
        ),
      )
      .then((rows) => rows[0]?.n ?? 0),
  );

  const newCount = cascade.extraction.rules.length;
  const verdict = evaluateExtractionGuardrails({
    prevRuleCount: prevCount,
    newRuleCount: newCount,
    newConfidence: cascade.extraction.confidence,
  });

  if (verdict.shouldFlagBroken) {
    await step.run("mark-broken-guardrail", async () => {
      const now = new Date();
      // All three writes in one transaction so Inngest retries don't
      // double-insert scrape_run audit rows.
      await db.transaction(async (tx) => {
        await tx.insert(scrapeRun).values({
          shulId: args.shulId,
          dataSourceId: args.dataSourceId,
          startedAt: now,
          finishedAt: now,
          status: "broken",
          rulesAdded: 0,
          rulesRemoved: 0,
          rulesChanged: 0,
          error: verdict.reason ?? "broken",
        });
        await tx
          .update(dataSource)
          .set({
            lastRunAt: now,
            lastRunStatus: "broken",
            reviewStatus: "pending",
            confidenceScore: cascade.extraction!.confidence,
            firstBrokenAt: sql`COALESCE(${dataSource.firstBrokenAt}, ${now})` as unknown as Date,
            updatedAt: now,
          })
          .where(eq(dataSource.id, args.dataSourceId));
        await tx.execute(sql`
          UPDATE shul
             SET status = 'pending_review', updated_at = NOW()
           WHERE id = ${args.shulId}
             AND status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM data_source ds2
                WHERE ds2.shul_id = shul.id
                  AND ds2.id <> ${args.dataSourceId}
                  AND ds2.review_status = 'approved'
                  AND ds2.last_run_status IN ('ok', 'no_change')
                  AND COALESCE(ds2.last_received_at, ds2.last_run_at) >=
                      NOW() - INTERVAL '14 days'
             )
        `);
      });
    });
    return {
      changed: false,
      broken: true,
      strategy: args.strategy,
      confidence: cascade.extraction.confidence,
    };
  }

  // Apply atomically: soft-delete + insert + data_source update + audit.
  // The whole block is one transaction so a partial failure mid-loop
  // doesn't leave duplicate rules on Inngest retry.
  //
  // Fix EE: soft-delete skips rules with is_manual_edit=true so admin
  // overrides survive across re-extractions.
  // Fix Q': clear firstBrokenAt on transition back to ok.
  const applied = await step.run("apply-changes", async () => {
    const now = new Date();
    return db.transaction(async (tx) => {
      const deleted = await tx
        .update(minyanRule)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(minyanRule.dataSourceId, args.dataSourceId),
            isNull(minyanRule.deletedAt),
            eq(minyanRule.isManualEdit, false),
          ),
        )
        .returning({ id: minyanRule.id });

      let inserted = 0;
      for (const r of cascade.extraction!.rules) {
        await insertRuleFromExtraction(tx, {
          shulId: args.shulId,
          dataSourceId: args.dataSourceId,
          rule: r,
          lastSeenAt: now,
        });
        inserted++;
      }

      await tx
        .update(dataSource)
        .set({
          identifier: submittedUrl,
          lastRunAt: now,
          lastRunStatus: "ok",
          // Recovery: restore reviewStatus='approved' if mark-broken
          // had flipped it to 'pending'. See the matching block in the
          // main scrapeOneShul apply-changes for the rationale (Fix P
          // requires approved for public freshness).
          reviewStatus: "approved",
          confidenceScore: cascade.extraction!.confidence,
          extractionStrategy: cascade.strategy,
          firstBrokenAt: null,
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
            reasoning: cascade.extraction!.reasoning,
            usage: cascade.usage,
          },
          updatedAt: now,
        })
        .where(eq(dataSource.id, args.dataSourceId));

      await tx.insert(scrapeRun).values({
        shulId: args.shulId,
        dataSourceId: args.dataSourceId,
        startedAt: now,
        finishedAt: new Date(),
        status: "ok",
        rulesAdded: inserted,
        rulesRemoved: deleted.length,
        rulesChanged: 0,
      });

      return { rulesAdded: inserted, rulesRemoved: deleted.length };
    });
  });

  return {
    changed: true,
    rulesAdded: applied.rulesAdded,
    rulesRemoved: applied.rulesRemoved,
    confidence: cascade.extraction.confidence,
    strategy: args.strategy,
  };
}
