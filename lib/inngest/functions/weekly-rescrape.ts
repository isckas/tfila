// Weekly cron — fans out one `shul.scrape.requested` event per
// approved (shul, data_source) pair. The actual scrape work happens
// in scrapeOneShul.
//
// Schedule: Mondays 13:00 UTC (~9am ET / 8am EST / 3pm GMT+2) —
// after the weekend, before most workday traffic.

import { and, eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import { dataSource, shul } from "../../../db/schema";

export const weeklyRescrape = inngest.createFunction(
  {
    id: "shul-weekly-rescrape",
    triggers: [{ cron: "0 13 * * MON" }],
  },
  async ({ step }) => {
    if (process.env.SCRAPE_ENABLED === "false") {
      return { skipped: true, reason: "SCRAPE_ENABLED=false" };
    }

    // Find every (active shul, approved data_source) pair.
    // The shul.status filter ensures we don't scrape archived shuls;
    // the data_source.review_status filter ensures we don't scrape
    // unreviewed (pending) or rejected configs.
    const targets = await step.run("list-targets", async () => {
      return db
        .select({
          shulId: shul.id,
          dataSourceId: dataSource.id,
          slug: shul.slug,
          url: dataSource.identifier,
        })
        .from(dataSource)
        .innerJoin(shul, eq(shul.id, dataSource.shulId))
        .where(
          and(
            eq(shul.status, "active"),
            eq(dataSource.reviewStatus, "approved"),
          ),
        );
    });

    if (targets.length === 0) {
      return { fanout: 0, note: "no approved data_sources to scrape" };
    }

    // Fan out — emit one event per target. Inngest's per-shulId
    // concurrency cap in scrapeOneShul throttles execution.
    await step.run("emit-events", async () => {
      await inngest.send(
        targets.map((t) => ({
          name: "shul.scrape.requested",
          data: {
            shulId: t.shulId,
            dataSourceId: t.dataSourceId,
            reason: "weekly" as const,
          },
        })),
      );
    });

    return {
      fanout: targets.length,
      shulIds: targets.map((t) => t.shulId),
    };
  },
);
