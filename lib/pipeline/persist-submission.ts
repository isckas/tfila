// Shared persist primitives for the URL + email + admin-extract paths.
// First slice (PR2 of FEATURES.md "Unified post-ingestion pipeline"):
// hoist the per-rule insert that's duplicated across 5 call sites.
//
// The full `persistSubmission()` orchestrator that the FEATURES.md design
// describes will land in PR3 along with normalizedPayload + the channel-
// specific call-site rewrites.

import { db } from "../../db/client";
import {
  minyanRule,
  serializeMinyanTime,
  type MinyanTime,
} from "../../db/schema";
import type { ExtractedRule } from "../llm/schema";

type DbOrTx =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Insert one minyan_rule from an LLM-extracted rule. Hoists the time
 * tagged-union conversion + insert pattern that was identical across:
 *   - lib/inngest/functions/build-data-source.ts (URL initial extract)
 *   - lib/inngest/functions/scrape-one-shul.ts × 2 (HTML + non-HTML rescrape)
 *   - app/api/admin/shul/[id]/extract/route.ts (admin re-extract)
 *   - lib/inngest/functions/process-email.ts (email forward)
 *
 * Pass `bumpSpecialPriority: true` (email path only) to give date-bounded
 * special-schedule rules priority 10 so they beat the regular rule on
 * date overlap. All other paths use priority 0 for everything.
 */
export async function insertRuleFromExtraction(
  qr: DbOrTx,
  args: {
    shulId: number;
    dataSourceId: number;
    rule: ExtractedRule;
    lastSeenAt: Date;
    bumpSpecialPriority?: boolean;
  },
): Promise<void> {
  const { rule: r } = args;
  const time: MinyanTime =
    r.time.kind === "fixed"
      ? { kind: "fixed", clock: r.time.clock }
      : { kind: "zmanim", anchor: r.time.anchor, offsetMin: r.time.offsetMin };

  const isSpecial =
    r.specialScheduleKind && r.specialScheduleKind !== "regular";
  const priority = args.bumpSpecialPriority && isSpecial ? 10 : 0;

  await qr.insert(minyanRule).values({
    shulId: args.shulId,
    dataSourceId: args.dataSourceId,
    tefillah: r.tefillah,
    tefillahLabel: r.tefillahLabel ?? null,
    daysOfWeek: r.daysOfWeek ?? null,
    time: serializeMinyanTime(time),
    validFrom: r.validFrom ?? null,
    validTo: r.validTo ?? null,
    specialScheduleKind: r.specialScheduleKind,
    priority,
    nusach: r.nusach ?? null,
    notes: r.notes ?? null,
    lastSeenInScrapeAt: args.lastSeenAt,
  });
}
