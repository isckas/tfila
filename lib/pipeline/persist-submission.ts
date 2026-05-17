// Shared persist primitives for the URL + email + admin-extract paths.
// FEATURES.md "Unified post-ingestion pipeline" — PRs 2 + 3.
//
// Three composable helpers, each owned by a single concern:
//   - insertRuleFromExtraction:       one minyan_rule from one ExtractedRule
//   - persistDataSourceWithRules:     full data_source row + all its rules
//   - applyShulNameAndAddressFromExtraction:
//                                     post-insert shul.name / shul.address
//                                     update with the placeholder guard
//
// Call sites compose them. The URL/admin path uses all three; the email
// path's "create new" branch uses persistDataSourceWithRules; rescrape
// paths use insertRuleFromExtraction directly with their own data_source
// update logic.

import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import {
  dataSource,
  minyanRule,
  serializeMinyanTime,
  type MinyanTime,
} from "../../db/schema";
import type { ExtractedRule, Extraction } from "../llm/schema";

type DbOrTx =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

type DataSourceKind =
  | "website_llm"
  | "shulcloud_website"
  | "email_newsletter"
  | "manual";

type ExtractionStrategy =
  | "html"
  | "js_rendered"
  | "pdf_document"
  | "vision_image"
  | "failed";

type RunStatus = "ok" | "no_change" | "broken" | "error";
type ReviewStatus = "pending" | "approved" | "rejected";

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
    sourceQuote: r.sourceQuote ?? null,
    lastSeenInScrapeAt: args.lastSeenAt,
  });
}

/**
 * Insert a fresh data_source row + all rules from an extraction. Used
 * by every "create new data_source" site:
 *   - URL initial extract (build-data-source.ts success branch)
 *   - URL initial extract failed (configJson + extractionStrategy=failed,
 *     rules=[] — caller passes confidenceScore=null)
 *   - Admin re-extract (app/api/admin/shul/[id]/extract/route.ts)
 *   - Email "first-ever for this shul" (process-email.ts new-shul branch)
 *   - Email "domain-merge attach as new data_source" (process-email.ts)
 *
 * configJson is opaque — channel callers build their own shape (cascade
 * vs email metadata vs admin trigger). Other column values are typed.
 *
 * Returns { dataSourceId, rulesInserted } for caller logging.
 */
export async function persistDataSourceWithRules(
  qr: DbOrTx,
  args: {
    shulId: number;
    kind: DataSourceKind;
    identifier: string;
    configJson: object;
    confidenceScore: number | null;
    extractionStrategy?: ExtractionStrategy | null;
    priority: number;
    lastRunAt: Date;
    lastReceivedAt?: Date | null;
    builtAt?: Date;
    lastRunStatus: RunStatus;
    reviewStatus?: ReviewStatus;
    rules: ExtractedRule[];
    /** Defaults to lastRunAt. */
    lastSeenAt?: Date;
    /** Email path: bump priority of special-schedule rules to 10. */
    bumpSpecialPriority?: boolean;
  },
): Promise<{ dataSourceId: number; rulesInserted: number }> {
  const lastSeen = args.lastSeenAt ?? args.lastRunAt;
  const builtAt = args.builtAt ?? args.lastRunAt;

  const [inserted] = await qr
    .insert(dataSource)
    .values({
      shulId: args.shulId,
      kind: args.kind,
      identifier: args.identifier,
      configJson: args.configJson,
      confidenceScore: args.confidenceScore,
      extractionStrategy: args.extractionStrategy ?? undefined,
      priority: args.priority,
      builtBy: "llm",
      builtAt,
      lastRunAt: args.lastRunAt,
      ...(args.lastReceivedAt != null
        ? { lastReceivedAt: args.lastReceivedAt }
        : {}),
      lastRunStatus: args.lastRunStatus,
      reviewStatus: args.reviewStatus ?? "pending",
    })
    .returning({ id: dataSource.id });

  const dataSourceId = inserted.id;

  let rulesInserted = 0;
  for (const r of args.rules) {
    await insertRuleFromExtraction(qr, {
      shulId: args.shulId,
      dataSourceId,
      rule: r,
      lastSeenAt: lastSeen,
      bumpSpecialPriority: args.bumpSpecialPriority,
    });
    rulesInserted++;
  }

  return { dataSourceId, rulesInserted };
}

/**
 * After a fresh extraction, conditionally update shul.name + shul.address
 * with the LLM-extracted values.
 *
 * - **Address**: COALESCE — only writes when shul.address IS NULL. Never
 *   overwrites an existing (admin-curated, Places-derived, or earlier-
 *   extracted) address.
 * - **Name**: only overwrites placeholder names (`name LIKE '%.%'` —
 *   anything that looks like a hostname — or `name = ''`). Never
 *   overwrites a clean human-readable name.
 *
 * Same predicate is used by URL + admin paths today; consolidating here
 * means future name-preference rules apply uniformly across channels.
 * Email path doesn't need this — it sets name + address on the initial
 * INSERT.
 */
export async function applyShulNameAndAddressFromExtraction(
  qr: DbOrTx,
  args: {
    shulId: number;
    extraction: Pick<Extraction, "shulName" | "shulAddress">;
  },
): Promise<void> {
  const { shulName, shulAddress } = args.extraction;
  if (shulAddress) {
    await qr.execute(sql`
      UPDATE shul
         SET address = COALESCE(address, ${shulAddress}),
             updated_at = NOW()
       WHERE id = ${args.shulId}
    `);
  }
  if (shulName) {
    await qr.execute(sql`
      UPDATE shul
         SET name = ${shulName},
             updated_at = NOW()
       WHERE id = ${args.shulId}
         AND (name LIKE '%.%' OR name = '')
    `);
  }
}
