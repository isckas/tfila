import { eq, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import { dataSource, minyanRule, shul, type MinyanTime } from "../../../db/schema";
import { runCascade, type CascadeResult } from "../../llm/cascade";

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

    return {
      dataSourceId: persisted.dataSourceId,
      strategy: result.strategy,
      rulesInserted: persisted.rulesInserted,
      confidence: result.extraction?.confidence ?? null,
      model: result.model,
      reasoning: result.extraction?.reasoning ?? null,
      winningUrl: result.winningUrl,
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
  const configJson = {
    version: 2,
    page_url: result.winningUrl,
    submitted_url: args.submittedUrl,
    extraction_strategy: result.strategy,
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
        identifier: result.winningUrl,
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
    for (const r of extraction.rules) {
      const time: MinyanTime =
        r.time.kind === "fixed"
          ? { kind: "fixed", clock: r.time.clock }
          : { kind: "zmanim", anchor: r.time.anchor, offsetMin: r.time.offsetMin };
      await tx.insert(minyanRule).values({
        shulId: args.shulId,
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
        lastSeenInScrapeAt: new Date(),
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
