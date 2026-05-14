import { eq, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import { dataSource, shul } from "../../../db/schema";
import { runCascade, type CascadeResult } from "../../llm/cascade";
import { backfillShulLocation } from "../../geocoding";
import { insertRuleFromExtraction } from "../../pipeline/persist-submission";

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
    // Per-host concurrency cap so we never DDoS one provider (ShulCloud,
    // Wix, etc) when many submissions land in the same minute.
    concurrency: {
      key: "event.data.url",
      limit: 2,
    },
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

    return {
      dataSourceId: persisted.dataSourceId,
      strategy: result.strategy,
      rulesInserted: persisted.rulesInserted,
      confidence: result.extraction?.confidence ?? null,
      model: result.model,
      reasoning: result.extraction?.reasoning ?? null,
      winningUrl: result.winningUrl,
      addressBackfill,
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
      const configJson = {
        version: 2,
        submitted_url: args.submittedUrl,
        cascade_attempts: result.attempts,
        usage: result.usage,
        extracted_at: new Date().toISOString(),
      };
      const [inserted] = await tx
        .insert(dataSource)
        .values({
          shulId: args.shulId,
          kind: args.sourceKind,
          identifier: args.submittedUrl,
          configJson,
          extractionStrategy: "failed",
          confidenceScore: null,
          builtBy: "llm",
          builtAt: new Date(),
          lastRunAt: new Date(),
          lastRunStatus: "broken",
          reviewStatus: "pending",
          priority: args.sourceKind === "shulcloud_website" ? 30 : 40,
        })
        .returning({ id: dataSource.id });
      // Mark the shul unsupported so weekly cron skips it.
      await tx
        .update(shul)
        .set({ status: "unsupported", updatedAt: new Date() })
        .where(eq(shul.id, args.shulId));
      return { dataSourceId: inserted.id, rulesInserted: 0 };
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
    const [inserted] = await tx
      .insert(dataSource)
      .values({
        shulId: args.shulId,
        kind: args.sourceKind,
        identifier,
        configJson,
        confidenceScore: extraction.confidence,
        extractionStrategy: result.strategy,
        builtBy: "llm",
        builtAt: new Date(),
        lastRunAt: new Date(),
        lastRunStatus: "ok",
        reviewStatus: "pending",
        priority: args.sourceKind === "shulcloud_website" ? 30 : 40,
      })
      .returning({ id: dataSource.id });
    const dataSourceId = inserted.id;

    let rulesInserted = 0;
    const lastSeenAt = new Date();
    for (const r of extraction.rules) {
      await insertRuleFromExtraction(tx, {
        shulId: args.shulId,
        dataSourceId,
        rule: r,
        lastSeenAt,
      });
      rulesInserted++;
    }

    if (extraction.shulAddress) {
      await tx.execute(sql`
        UPDATE shul
           SET address = COALESCE(address, ${extraction.shulAddress}),
               updated_at = NOW()
         WHERE id = ${args.shulId}
      `);
    }
    if (extraction.shulName) {
      const hostname = (() => {
        try {
          return new URL(args.submittedUrl).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })();
      await tx.execute(sql`
        UPDATE shul
           SET name = ${extraction.shulName},
               updated_at = NOW()
         WHERE id = ${args.shulId}
           AND (name = ${hostname} OR name LIKE '%.%')
      `);
    }

    return { dataSourceId, rulesInserted };
  });
}

export { hostOfUrl };
