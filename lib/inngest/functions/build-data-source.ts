import { sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import {
  dataSource,
  minyanRule,
  type MinyanTime,
} from "../../../db/schema";
import { fetchHtml } from "../../scrapers/fetch";
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

    // ─── 1. Fetch the page ──────────────────────────────────────────
    const fetched = await step.run("fetch-html", async () => {
      const res = await fetchHtml(url, { timeoutMs: 20_000 });
      if (!res.ok) {
        throw new Error(`Fetch failed: HTTP ${res.status} for ${url}`);
      }
      return { html: res.html, finalUrl: res.finalUrl, status: res.status };
    });

    // ─── 2. LLM extract (Haiku → Sonnet fallback) ───────────────────
    const extracted = await step.run("llm-extract", async () => {
      return extractFromHtml(fetched.html);
    });

    // ─── 3. Persist ─────────────────────────────────────────────────
    const persisted = await step.run("persist", async () => {
      return persistExtraction({
        shulId,
        url,
        sourceKind,
        fetchedStatus: fetched.status,
        fetchedFinalUrl: fetched.finalUrl,
        extraction: extracted.extraction,
        model: extracted.model,
        pageContentHash: extracted.pageContentHash,
        usage: extracted.usage,
      });
    });

    return {
      dataSourceId: persisted.dataSourceId,
      rulesInserted: persisted.rulesInserted,
      confidence: extracted.extraction.confidence,
      model: extracted.model,
      reasoning: extracted.extraction.reasoning,
    };
  },
);

interface PersistArgs {
  shulId: number;
  url: string;
  sourceKind: "website_llm" | "shulcloud_website";
  fetchedStatus: number;
  fetchedFinalUrl: string;
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
    page_url: args.url,
    final_url: args.fetchedFinalUrl,
    fetched_status: args.fetchedStatus,
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
        identifier: args.url,
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

    return { dataSourceId, rulesInserted };
  });
}

// Re-export for index modules
export { hostOfUrl };
