// Weekly cron — fans out one `shul.scrape.requested` event per
// approved (shul, data_source) pair. The actual scrape work happens
// in scrapeOneShul.
//
// Schedule: Sundays 03:00 UTC = Saturdays 22:00 ET (motzaei Shabbos
// year-round, accounting for both EST/EDT). Shuls typically publish
// next week's bulletin on Saturday night or Sunday morning, so a
// Saturday-night run captures the freshest schedule before Sunday
// daveners hit the feed.

import { and, eq, ne } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import { dataSource, shul } from "../../../db/schema";
import { reportInngestFailure } from "../on-failure";

export const weeklyRescrape = inngest.createFunction(
  {
    id: "shul-weekly-rescrape",
    onFailure: reportInngestFailure("shul-weekly-rescrape"),
    triggers: [{ cron: "0 3 * * SUN" }],
  },
  async ({ step }) => {
    if (process.env.SCRAPE_ENABLED === "false") {
      return { skipped: true, reason: "SCRAPE_ENABLED=false" };
    }

    // Find every (non-archived shul, approved data_source) pair.
    // The shul.status filter only excludes admin-archived shuls; the
    // data_source.review_status filter ensures we don't scrape unreviewed
    // (pending) or rejected configs.
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
            // Drive the worklist off the source's approval + "not archived",
            // not a derived `status='active'` — so a shul that recovered (or is
            // mid-recovery) stays in the cron instead of being trapdoored out
            // of the fan-out forever. See plan E-A1 / C2.
            ne(shul.status, "archived"),
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
