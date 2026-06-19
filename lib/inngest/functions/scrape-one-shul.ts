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
import {
  runCascade,
  isTransientCascadeFailure,
  transientCascadeMessage,
  summarizeCascadeFailure,
  discoverResources,
  sameResource,
} from "../../llm/cascade";
import { evaluateExtractionGuardrails } from "../../pipeline/guardrails";
import { insertRuleFromExtraction } from "../../pipeline/persist-submission";
import { reportInngestFailure } from "../on-failure";

// Permissive step type — we only use step.run. Avoids the gnarly
// `Parameters<typeof inngest.createFunction>[…]` extraction while
// still letting us pass `step` into helper functions for memoization.
type Step = {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
};

export const scrapeOneShul = inngest.createFunction(
  {
    id: "shul-scrape-one",
    onFailure: reportInngestFailure("shul-scrape-one"),
    concurrency: [
      // GLOBAL cap across the whole fleet. The 2026-05-24 regression was an
      // unthrottled ~41-way weekly fan-out that hammered Anthropic into 429s;
      // because the rescrape pinned a single tier, those transient 429s became
      // permanent "cascade exhausted all tiers" demotions and the site dropped
      // 41→9 active shuls. Keep concurrent LLM-bound scrapes low so a rate
      // limit can never cascade into mass breakage again. See plan C1 / E-D1.
      { limit: 3 },
      // Best-effort per-host limit. The event payload doesn't carry the host
      // directly; we use shulId as a proxy (one shul = one host).
      { key: "event.data.shulId", limit: 1 },
    ],
    triggers: [{ event: "shul.scrape.requested" }],
  },
  async ({ event, step }) => {
    const { shulId, dataSourceId, reason } = event.data as {
      shulId: number;
      dataSourceId: number;
      reason: "weekly" | "manual" | "recheck";
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
        lastRunStatus: loaded.lastRunStatus,
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
      // Don't hide a previously-healthy shul on an operational pause (budget /
      // kill switch): last_run_status='error' would drop it from search/feed.
      // Skip this run with its state untouched (it re-attempts next cron once the
      // gate reopens); only record 'error' when the source was already
      // non-healthy. Mirrors the non-HTML rescrape cost-gate.
      if (priorWasOk) {
        return { changed: false, reason: "cost-gated-skipped" };
      }
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
      const r = await runCascade(url, {
        preferredStrategy: "html",
        shulId,
        timeoutMs: 25_000,
      });
      // Transient infra failure (Anthropic 429/5xx, fetch timeout, network) —
      // throw so Inngest retries the whole step with backoff rather than
      // recording a permanent "broken" run. The 2026-05-24 mass regression was
      // transient 429s treated as terminal. See plan C1 / M2.
      if (isTransientCascadeFailure(r)) throw new Error(transientCascadeMessage(r));
      return r;
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
      ? {
          shouldFlagBroken: true,
          reason: summarizeCascadeFailure(cascade.attempts, "html"),
        }
      : evaluateExtractionGuardrails({
          prevRuleCount: prevCount,
          newRuleCount: newCount,
          newConfidence,
        });

    if (verdict.shouldFlagBroken) {
      // Terminal failure (a transient one would have thrown above). Record a
      // broken run and keep the old rules in place. We do NOT touch
      // review_status (sticky — E-A4) or shul.status (visibility is derived —
      // E-A2); the source stays approved so the weekly cron keeps retrying it
      // and it self-heals. Wrapped in a transaction so an Inngest retry doesn't
      // double-insert the scrape_run audit row.
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
              // E-A4: keep review_status STICKY. A run outcome belongs in
              // last_run_status, not review_status; wiping the human's approval
              // on a broken run is what created the no-recovery trapdoor (the
              // cron only re-fans approved sources). Leaving it approved lets
              // the weekly cron keep retrying so the source self-heals.
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
          // E-A2: no shul.status demotion. Public visibility is now a pure
          // function of "has a fresh approved+ok source" (lib/queries.ts), so a
          // broken run hides the shul automatically. Not churning shul.status
          // kills the demote/restore dance behind the 30+ "Fix X" patches.
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
            // Re-approve on recovery. Under the E-A4 sticky-review model
            // mark-broken no longer demotes review_status, so on the normal
            // weekly-cron path this is a no-op (the source is already
            // 'approved'). It's load-bearing for the RECOVERY path:
            // scripts/recover-stranded.mjs re-fans shul.scrape.requested at
            // sources the pre-P1 code demoted to 'pending' during the 429
            // storm; this restores them to 'approved' so they re-qualify for
            // the public freshness gate (lib/freshness.ts + the EXISTS clauses
            // in lib/queries.ts, all of which require review_status='approved').
            // Intentionally asymmetric with process-email.ts, which does NOT
            // auto-approve — a never-reviewed source must not auto-approve
            // (those enter via data-source.requested/buildDataSource, not here).
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
    lastRunStatus: string | null;
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

  // ─── Phase 2: cheap change-detection (no LLM) ───────────────
  // Probe the page for the current schedule image/PDF and compare it to the one
  // we last extracted. If it's the SAME resource, nothing new was posted — skip
  // the expensive vision/PDF LLM. This is what makes the daily re-check cron
  // affordable. (js_rendered has no discrete resource → discoverResources returns
  // [] → falls through to a normal re-extract.)
  //
  // Accepted residual: we use membership ("is the last resource still present?")
  // rather than a top-candidate compare, because last_extracted_resource is the
  // candidate that actually EXTRACTED (winningUrl) and can rank below a decoy —
  // position-0 compare would false-"change" those forever. The trade: if a site
  // hardcodes the OLD poster URL in static HTML AND swaps in a new one via JS
  // (old URL lingers in the candidate set), a real rotation reads as unchanged.
  // No current source is known to do this; the weekly cron + admin Extract Now
  // are the backstop. Revisit with candidate-set equality if one surfaces.
  const lastResource = (
    args.previousConfig as { last_extracted_resource?: string } | null
  )?.last_extracted_resource;
  const priorWasOk =
    args.lastRunStatus === "ok" || args.lastRunStatus === "no_change";
  if (lastResource) {
    // `null` = probe couldn't load the page at all (transient outage / WAF). Do
    // NOT throw here: a persistent block would otherwise exhaust retries and fire
    // an onFailure alert on EVERY cron run (unbounded alert spam). Instead null
    // falls through to the cost-gate + cascade below, which carries its own
    // transient-retry (isTransientCascadeFailure → throw) and writes exactly ONE
    // broken row on a persistent non-transient failure.
    const current = await step.run("detect-change", async () => {
      const probe = await discoverResources(submittedUrl, args.strategy, {
        timeoutMs: 15_000,
        knownResource: lastResource,
      });
      return probe.probeFailed ? null : probe.candidates;
    });
    // Unchanged = the resource we last extracted is still present (compared by
    // canonical key, so a fresh ?v= cache-buster doesn't read as changed).
    // Membership, NOT position-0: last_extracted_resource is the candidate that
    // actually EXTRACTED (winningUrl), which can rank below a decoy; a genuine
    // rotation yields a new dated filename absent from the set → not unchanged.
    const unchanged =
      current !== null && current.some((c) => sameResource(c, lastResource));
    if (unchanged && priorWasOk) {
      // Healthy + the poster hasn't changed → no_change, skip the LLM.
      await step.run("write-no-change-nonhtml", async () => {
        const now = new Date();
        await db.insert(scrapeRun).values({
          shulId: args.shulId,
          dataSourceId: args.dataSourceId,
          startedAt: now,
          finishedAt: now,
          status: "no_change",
          rulesAdded: 0,
          rulesRemoved: 0,
          rulesChanged: 0,
        });
        await db
          .update(dataSource)
          .set({
            lastRunAt: now,
            lastRunStatus: "no_change",
            updatedAt: now,
          })
          .where(eq(dataSource.id, args.dataSourceId));
      });
      return { changed: false, strategy: args.strategy };
    }
    // unchanged && !priorWasOk → fall through (NO early return). A broken source
    // on an unchanged poster still earns a fresh recovery extract each cron run
    // until it recovers or ages out of the daily-recheck window — matching the
    // HTML path's Fix I invariant (never lock a broken source into broken). The
    // re-extract is bounded by the 14-day recheck window + the $25/day cost-gate
    // below, so a genuinely-dead poster can't burn unbounded LLM. (An earlier
    // draft short-circuited here with {broken:true}; that made a guardrail-dip
    // break on an unchanged poster permanently unrecoverable — the trapdoor the
    // HTML Fix I exists to prevent.)
    //
    // changed (unchanged === false, incl. probe null) → also falls through.
  }

  // ─── Cost gate — kill switch + daily budget cap (mirrors the HTML path).
  // The change-detection probe above is free; the cascade below spends LLM, so
  // gate HERE (not before the probe) — that keeps the no_change short-circuit
  // working under budget pressure instead of needlessly flipping unchanged
  // healthy posters to `error`. On a bail write a scrape_run marked `error`
  // (NOT `broken`): a budget / kill-switch stop is operational, not a content
  // failure. Before this gate a cost-blocked runCascade returned
  // strategy='failed' and fell into mark-broken below, wrongly demoting healthy
  // sources to broken whenever the daily cap was hit.
  const gate = await step.run("cost-gate-nonhtml", async () => {
    const { checkCostGate } = await import("../../llm/cost-gate");
    return checkCostGate();
  });
  if (!gate.allowed) {
    // A budget / kill-switch pause must NOT hide a previously-healthy shul:
    // last_run_status='error' would drop it from search/feed. If the source was
    // ok/no_change, leave its state untouched and just skip this cycle (it
    // re-attempts next cron once the gate reopens). Only RECORD an 'error' run
    // when the source was already non-healthy — so we don't mask a real break
    // and the admin still sees the operational bail.
    if (priorWasOk) {
      return { changed: false, strategy: args.strategy };
    }
    const gateMsg =
      gate.reason === "kill_switch"
        ? "extraction disabled via EXTRACTION_DISABLED kill switch"
        : `daily LLM budget exceeded (today $${gate.todayUsd?.toFixed(2)} / cap $${gate.budgetUsd?.toFixed(2)})`;
    await step.run("write-scrape-run-cost-gated-nonhtml", async () => {
      const now = new Date();
      await db.insert(scrapeRun).values({
        shulId: args.shulId,
        dataSourceId: args.dataSourceId,
        startedAt: now,
        finishedAt: now,
        status: "error",
        rulesAdded: 0,
        rulesRemoved: 0,
        rulesChanged: 0,
        error: gateMsg,
      });
      await db
        .update(dataSource)
        .set({ lastRunAt: now, lastRunStatus: "error", updatedAt: now })
        .where(eq(dataSource.id, args.dataSourceId));
    });
    return { changed: false, strategy: args.strategy };
  }

  const cascade = await step.run("cascade-rerun", async () => {
    const r = await runCascade(submittedUrl, {
      timeoutMs: 25_000,
      preferredStrategy: args.strategy,
      shulId: args.shulId,
    });
    // Transient infra failure → throw so Inngest retries instead of demoting.
    // See plan C1 / M2 and the HTML path above.
    if (isTransientCascadeFailure(r)) throw new Error(transientCascadeMessage(r));
    return r;
  });

  if (cascade.strategy === "failed" || !cascade.extraction) {
    // Phase 1 (diagnosability): write a SPECIFIC error summarized from the
    // per-tier attempts (was a generic "cascade re-run failed for strategy X"),
    // and PERSIST the attempts into config_json.last_rejected_extraction —
    // mirroring the HTML broken path — so the admin BROKEN lane can show WHY
    // (no schedule image / low confidence / 404) instead of guessing. Does NOT
    // clobber config_json.cascade_attempts (the last GOOD extraction's record).
    const failureSummary = summarizeCascadeFailure(cascade.attempts, args.strategy);
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
          error: failureSummary,
        });
        await tx
          .update(dataSource)
          .set({
            lastRunAt: now,
            lastRunStatus: "broken",
            // E-A4: review_status stays sticky (see scrapeOneShul mark-broken).
            firstBrokenAt: sql`COALESCE(${dataSource.firstBrokenAt}, ${now})` as unknown as Date,
            updatedAt: now,
            configJson: {
              ...(args.previousConfig ?? {}),
              last_rejected_extraction: {
                at: now.toISOString(),
                model: cascade.model,
                reason: failureSummary,
                cascade_attempts: cascade.attempts,
              },
            },
          })
          .where(eq(dataSource.id, args.dataSourceId));
        // E-A2: no shul.status demotion (visibility is derived). See the HTML
        // mark-broken path.
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
            // E-A4: review_status stays sticky.
            confidenceScore: cascade.extraction!.confidence,
            firstBrokenAt: sql`COALESCE(${dataSource.firstBrokenAt}, ${now})` as unknown as Date,
            updatedAt: now,
          })
          .where(eq(dataSource.id, args.dataSourceId));
        // E-A2: no shul.status demotion (visibility is derived). See the HTML
        // mark-broken path.
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
