import { sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import {
  dataSource,
  minyanRule,
  type MinyanTime,
} from "../../../db/schema";
import {
  extractFromUrlWithFallback,
  type FallbackAttempt,
} from "../../llm/extract-with-fallback";
import { extractFromHtml } from "../../llm/extract";

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
    const { shulId, url, sourceKind } = event.data as {
      shulId: number;
      url: string;
      sourceKind: "website_llm" | "shulcloud_website";
    };

    // ─── Kill switch ────────────────────────────────────────────────
    if (process.env.SCRAPE_ENABLED === "false") {
      return { skipped: true, reason: "SCRAPE_ENABLED=false" };
    }

    // ─── 1+2. Fetch & extract, with same-origin candidate-URL fallback ──
    // If the submitted URL's page yields nothing (e.g. /calendar is an
    // events widget on a Reform shul where times live at /worship/shabbat),
    // we try a small set of well-known service-times paths on the same origin.
    const extracted = await step.run("fetch-and-extract", async () => {
      return extractFromUrlWithFallback(url, { timeoutMs: 20_000 });
    });

    // ─── 3. Persist ─────────────────────────────────────────────────
    const persisted = await step.run("persist", async () => {
      return persistExtraction({
        shulId,
        url,
        winningUrl: extracted.winningUrl,
        usedFallback: extracted.usedFallback,
        attempts: extracted.attempts,
        sourceKind,
        extraction: extracted.result.extraction,
        model: extracted.result.model,
        pageContentHash: extracted.result.pageContentHash,
        usage: extracted.result.usage,
      });
    });

    return {
      dataSourceId: persisted.dataSourceId,
      rulesInserted: persisted.rulesInserted,
      confidence: extracted.result.extraction.confidence,
      model: extracted.result.model,
      reasoning: extracted.result.extraction.reasoning,
      winningUrl: extracted.winningUrl,
      usedFallback: extracted.usedFallback,
    };
  },
);

interface PersistArgs {
  shulId: number;
  /** The URL the user originally submitted. */
  url: string;
  /** The URL that actually produced the winning extraction (may differ from submitted). */
  winningUrl: string;
  usedFallback: boolean;
  attempts: FallbackAttempt[];
  sourceKind: "website_llm" | "shulcloud_website";
  extraction: Awaited<ReturnType<typeof extractFromHtml>>["extraction"];
  model: "claude-haiku-4-5" | "claude-sonnet-4-6";
  pageContentHash: string;
  usage: Awaited<ReturnType<typeof extractFromHtml>>["usage"];
}

async function persistExtraction(args: PersistArgs): Promise<{
  dataSourceId: number;
  rulesInserted: number;
}> {
  const configJson = {
    version: 1,
    page_url: args.winningUrl,
    submitted_url: args.url,
    used_fallback: args.usedFallback,
    fallback_attempts: args.attempts,
    page_content_hash: args.pageContentHash,
    model: args.model,
    prompt_version: "tfila-v1",
    extracted_at: new Date().toISOString(),
    reasoning: args.extraction.reasoning,
    usage: args.usage,
  };

  return db.transaction(async (tx) => {
    // Create a new data_source row for this build. (Older builds for the
    // same shul + URL coexist; admin reviewer picks the canonical one.)
    const [inserted] = await tx
      .insert(dataSource)
      .values({
        shulId: args.shulId,
        kind: args.sourceKind,
        identifier: args.winningUrl,
        configJson,
        confidenceScore: args.extraction.confidence,
        builtBy: "llm",
        builtAt: new Date(),
        lastRunAt: new Date(),
        lastRunStatus: "ok",
        reviewStatus: "pending",
        priority: args.sourceKind === "shulcloud_website" ? 30 : 40,
      })
      .returning({ id: dataSource.id });

    const dataSourceId = inserted.id;

    // Insert one minyan_rule per extracted rule.
    let rulesInserted = 0;
    for (const r of args.extraction.rules) {
      const time: MinyanTime =
        r.time.kind === "fixed"
          ? { kind: "fixed", clock: r.time.clock }
          : {
              kind: "zmanim",
              anchor: r.time.anchor,
              offsetMin: r.time.offsetMin,
            };

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

    // If the extractor surfaced a shul address and the shul has none yet,
    // populate it (geocoding will happen later when the field is non-null).
    if (args.extraction.shulAddress) {
      await tx.execute(sql`
        UPDATE shul
           SET address = COALESCE(address, ${args.extraction.shulAddress}),
               updated_at = NOW()
         WHERE id = ${args.shulId}
      `);
    }

    // If the extractor surfaced a real shul name and the shul row still
    // has the URL-derived placeholder name, upgrade it. We detect a
    // placeholder by it equaling the bare hostname or containing ".".
    if (args.extraction.shulName) {
      const hostname = (() => {
        try {
          return new URL(args.url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })();
      await tx.execute(sql`
        UPDATE shul
           SET name = ${args.extraction.shulName},
               updated_at = NOW()
         WHERE id = ${args.shulId}
           AND (name = ${hostname} OR name LIKE '%.%')
      `);
    }

    return { dataSourceId, rulesInserted };
  });
}

// Re-export for index modules
export { hostOfUrl };
