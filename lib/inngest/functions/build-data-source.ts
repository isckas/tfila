import { and, eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import { shul } from "../../../db/schema";
import { runCascade, type CascadeResult } from "../../llm/cascade";
import {
  backfillShulLocation,
  geocodeAddressIfMissingLocation,
} from "../../geocoding";
import {
  persistDataSourceWithRules,
  applyShulNameAndAddressFromExtraction,
} from "../../pipeline/persist-submission";

function hostOfUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

export const buildDataSource = inngest.createFunction(
  {
    id: "data-source-build",
    // Concurrency keyed on shulId — same key as scrapeOneShul — so the
    // initial-build path and the rescrape path are mutually exclusive
    // for a given shul. Otherwise an admin "Re-extract" while the
    // weekly cron is mid-flight on the same shul double-writes
    // data_source rows + races on the shul.address / shul.name COALESCE.
    concurrency: [
      // GLOBAL cap — the admin "re-extract all" / bulk recovery path fans out
      // through here, so it needs the same fleet-wide throttle as the weekly
      // cron to avoid re-triggering the 429 storm. See plan C1 / E-D1 / UI-5.
      { limit: 3 },
      { key: "event.data.shulId", limit: 1 },
    ],
    triggers: [{ event: "data-source.requested" }],
  },
  async ({ event, step }) => {
    const { shulId, url, sourceKind, preferredStrategy } = event.data as {
      shulId: number;
      url: string;
      sourceKind: "website_llm" | "shulcloud_website";
      preferredStrategy?:
        | "html"
        | "js_rendered"
        | "pdf_document"
        | "vision_image";
    };

    // ─── Kill switch ────────────────────────────────────────────────
    if (process.env.SCRAPE_ENABLED === "false") {
      return { skipped: true, reason: "SCRAPE_ENABLED=false" };
    }

    // ─── Run the cascade (HTML → JS → PDF → Vision → failed) ────────
    const result = await step.run("cascade", async () => {
      return runCascade(url, {
        timeoutMs: 25_000,
        preferredStrategy,
        shulId,
      });
    });

    // ─── Persist (handles success and failed-tier cases) ────────────
    const persisted = await step.run("persist", async () => {
      return persistCascade({ shulId, submittedUrl: url, sourceKind, result });
    });

    // ─── Address fallback: Places search if shul has no address ─────
    // Some shul sites don't expose their address in scrapable HTML
    // (especially image/PDF-published shuls). Try Google Places by
    // shul name + URL host hint. Apply when confidence ≥ 0.7.
    //
    // Shared helper — same call site used by process-email.ts. See
    // FEATURES.md "Unified post-ingestion pipeline" for the principle.
    const addressBackfill = await step.run("address-fallback", async () => {
      const rows = await db
        .select({ name: shul.name })
        .from(shul)
        .where(eq(shul.id, shulId))
        .limit(1);
      const shulName = rows[0]?.name ?? "";
      return backfillShulLocation({ shulId, name: shulName, urlHint: url });
    });

    // After backfill: geocode the address into a location point if one
    // didn't get set. Catches the case where extraction.shulAddress
    // populated shul.address but Places didn't fire (or was skipped
    // because address was already set). Without a location point the
    // shul is invisible to home-feed distance queries.
    const locationGeocode = await step.run("geocode-location-fallback", async () =>
      geocodeAddressIfMissingLocation({ shulId }),
    );

    return {
      dataSourceId: persisted.dataSourceId,
      strategy: result.strategy,
      rulesInserted: persisted.rulesInserted,
      confidence: result.extraction?.confidence ?? null,
      model: result.model,
      reasoning: result.extraction?.reasoning ?? null,
      winningUrl: result.winningUrl,
      addressBackfill,
      locationGeocode,
    };
  },
);

interface PersistArgs {
  shulId: number;
  submittedUrl: string;
  sourceKind: "website_llm" | "shulcloud_website";
  result: CascadeResult;
}

async function persistCascade(args: PersistArgs): Promise<{
  dataSourceId: number;
  rulesInserted: number;
}> {
  const { result } = args;

  // ─── Failed: mark the shul unsupported, record a failed data_source ─
  if (result.strategy === "failed" || !result.extraction) {
    return db.transaction(async (tx) => {
      const now = new Date();
      const persisted = await persistDataSourceWithRules(tx, {
        shulId: args.shulId,
        kind: args.sourceKind,
        identifier: args.submittedUrl,
        configJson: {
          version: 2,
          submitted_url: args.submittedUrl,
          cascade_attempts: result.attempts,
          usage: result.usage,
          extracted_at: now.toISOString(),
        },
        confidenceScore: null,
        extractionStrategy: "failed",
        priority: args.sourceKind === "shulcloud_website" ? 30 : 40,
        lastRunAt: now,
        lastRunStatus: "broken",
        rules: [],
      });
      // Mark the shul unsupported so weekly cron skips it.
      await tx
        .update(shul)
        .set({ status: "unsupported", updatedAt: now })
        .where(eq(shul.id, args.shulId));
      return persisted;
    });
  }

  // ─── Success: persist data_source + rules ────────────────────────
  // The early-return above narrows `result.strategy !== 'failed'`, but
  // the compiler can't follow that to result.extraction being non-null.
  // Pull it into a local for clean access.
  const extraction = result.extraction;

  // Vision/PDF strategies extract from a per-week resource (e.g.
  // Times-Bamidbar5786.png) whose filename rotates weekly. Store the
  // submitted page URL as the identifier so weekly rescrapes re-target
  // the page (which re-discovers the new week's resource); keep the
  // specific resource URL in configJson for the audit trail.
  const isResourceStrategy =
    result.strategy === "vision_image" || result.strategy === "pdf_document";
  const identifier = isResourceStrategy ? args.submittedUrl : result.winningUrl;
  const pageUrl = isResourceStrategy ? args.submittedUrl : result.winningUrl;

  const configJson = {
    version: 2,
    page_url: pageUrl,
    submitted_url: args.submittedUrl,
    extraction_strategy: result.strategy,
    last_extracted_resource: isResourceStrategy ? result.winningUrl : undefined,
    cascade_attempts: result.attempts,
    page_content_hash: result.pageContentHash,
    model: result.model,
    prompt_version: "tfila-v1",
    extracted_at: new Date().toISOString(),
    reasoning: extraction.reasoning,
    usage: result.usage,
  };

  return db.transaction(async (tx) => {
    const now = new Date();
    const persisted = await persistDataSourceWithRules(tx, {
      shulId: args.shulId,
      kind: args.sourceKind,
      identifier,
      configJson,
      confidenceScore: extraction.confidence,
      extractionStrategy: result.strategy,
      priority: args.sourceKind === "shulcloud_website" ? 30 : 40,
      lastRunAt: now,
      lastRunStatus: "ok",
      rules: extraction.rules,
    });
    await applyShulNameAndAddressFromExtraction(tx, {
      shulId: args.shulId,
      extraction,
    });
    // If the shul was previously marked `unsupported` (cascade failed),
    // restore to `pending_review` so admin can re-approve the new
    // data_source. Conditional on the current status — `active` shuls
    // stay active. Replaces the indiscriminate `UPDATE shul SET
    // status='pending_review'` that lived in the old inline admin
    // Extract Now route before it went async via this worker.
    await tx
      .update(shul)
      .set({ status: "pending_review", updatedAt: now })
      .where(and(eq(shul.id, args.shulId), eq(shul.status, "unsupported")));
    return persisted;
  });
}

export { hostOfUrl };
