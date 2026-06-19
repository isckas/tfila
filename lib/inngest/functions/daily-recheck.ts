// Daily cron — fans out `shul.scrape.requested` for image/PDF sources only.
// Weekly-flyer shuls (vision_image / pdf_document) rotate their poster on an
// unpredictable day; the weekly cron alone means up to a week of staleness when
// a new poster lands mid-week, and up to a week to recover a broken one. This
// re-checks them once a day so freshness/recovery is within ~24h, not ~7 days.
//
// It is CHEAP because scrapeOneShul's change-detection probe (lib/llm/cascade.ts
// discoverResources) fetches the page (NO LLM) and only spends the vision/PDF
// LLM when the poster actually CHANGED — so the daily cadence costs ~the same
// LLM as weekly, just timed to the real update. The probe also avoids a
// Browserless render entirely when the last poster is already in static HTML;
// JS-injected posters render at most once/day/source here. The concurrency cap
// (3) in scrapeOneShul + the $25/day cost-gate are the hard LLM backstops.
//
// Cadence note: this was prototyped at every-2-hours, but an adversarial review
// showed the 12×/day cadence amplified (bounded-but-unmetered) Browserless
// renders and the budget-exhaustion blast radius for marginal extra freshness on
// a weekly schedule. Daily is the cost/value balance the user chose.
//
// Scope: approved vision/pdf sources that are healthy (keep fresh on change) OR
// recently broken (≤14d → fast recovery). Long-dead sources fall back to the
// weekly cron + manual attention, so we don't poll dead pages forever.

import { and, eq, ne, inArray, or, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import { dataSource, shul } from "../../../db/schema";
import { reportInngestFailure } from "../on-failure";

export const dailyRecheck = inngest.createFunction(
  {
    id: "shul-daily-recheck",
    onFailure: reportInngestFailure("shul-daily-recheck"),
    triggers: [{ cron: "0 5 * * *" }],
  },
  async ({ step }) => {
    if (process.env.SCRAPE_ENABLED === "false") {
      return { skipped: true, reason: "SCRAPE_ENABLED=false" };
    }
    // Kill switch: if LLM extraction is disabled, don't even fan out — every
    // downstream scrapeOneShul would cost-gate anyway, so skip the events.
    if (process.env.EXTRACTION_DISABLED === "true") {
      return { skipped: true, reason: "EXTRACTION_DISABLED=true" };
    }

    const targets = await step.run("list-image-pdf-targets", async () => {
      return db
        .select({
          shulId: shul.id,
          dataSourceId: dataSource.id,
          slug: shul.slug,
        })
        .from(dataSource)
        .innerJoin(shul, eq(shul.id, dataSource.shulId))
        .where(
          and(
            ne(shul.status, "archived"),
            eq(dataSource.reviewStatus, "approved"),
            // Image/PDF sources only — these are the ones whose poster rotates
            // on an unknown day. HTML/ShulCloud sources stay on the weekly cron.
            inArray(dataSource.extractionStrategy, [
              "vision_image",
              "pdf_document",
            ]),
            // Healthy OR recently-broken (≤14d). Beyond that, stop the intensive
            // polling — a genuinely dead source belongs to weekly + the admin.
            or(
              inArray(dataSource.lastRunStatus, ["ok", "no_change"]),
              // Recently broken (≤14d) → keep fast-recovery polling. COALESCE to
              // lastRunAt so sources with NULL firstBrokenAt are still covered:
              // 'error' bails never set firstBrokenAt, and legacy broken rows
              // predate the column — without this they'd silently drop off the
              // recheck and only the slow weekly cron would retry them.
              sql`COALESCE(${dataSource.firstBrokenAt}, ${dataSource.lastRunAt}) >= NOW() - INTERVAL '14 days'`,
            ),
          ),
        );
    });

    if (targets.length === 0) {
      return { fanout: 0, note: "no image/pdf sources to re-check" };
    }

    await step.run("emit-events", async () => {
      await inngest.send(
        targets.map((t) => ({
          name: "shul.scrape.requested",
          data: {
            shulId: t.shulId,
            dataSourceId: t.dataSourceId,
            reason: "recheck" as const,
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
