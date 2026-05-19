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

import { and, eq, isNull, sql } from "drizzle-orm";
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
): Promise<{ dataSourceId: number; rulesInserted: number; supersededDataSourceId: number | null }> {
  const lastSeen = args.lastSeenAt ?? args.lastRunAt;
  const builtAt = args.builtAt ?? args.lastRunAt;

  // ─── Fix C — supersede existing same-(shul, identifier) source ──────
  // Before creating a new data_source for this URL/email/identifier, see
  // if one already exists for the same shul. If it does AND it's an
  // approved+ok source, mark it rejected with a "superseded" note and
  // soft-delete its minyan_rule rows so they don't double up with the
  // new extraction's rules. Same transaction = atomic.
  //
  // This closes the supersede gap that produced the v2-canary duplicates
  // (BAYT ds 41+99, Chabad 52+106) and the same-day-double-submit
  // duplicates (Adath Israel, Shaarei Shomayim, etc.).
  const existingSameIdentifier = await qr
    .select({
      id: dataSource.id,
      reviewStatus: dataSource.reviewStatus,
      lastRunStatus: dataSource.lastRunStatus,
    })
    .from(dataSource)
    .where(
      and(
        eq(dataSource.shulId, args.shulId),
        eq(dataSource.identifier, args.identifier),
        sql`${dataSource.reviewStatus} <> 'rejected'`,
      ),
    );

  let supersededDataSourceId: number | null = null;
  for (const old of existingSameIdentifier) {
    supersededDataSourceId = old.id;
    await qr
      .update(dataSource)
      .set({
        reviewStatus: "rejected",
        reviewerNotes: `superseded by new extraction on ${args.lastRunAt.toISOString().slice(0, 10)}`,
        updatedAt: new Date(),
      })
      .where(eq(dataSource.id, old.id));
    await qr
      .update(minyanRule)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(minyanRule.dataSourceId, old.id),
          isNull(minyanRule.deletedAt),
        ),
      );
  }

  // ─── Fix D — auto-reject failed extractions ─────────────────────────
  // When the cascade gives up (strategy='failed') there's nothing for an
  // admin to review. Auto-reject at insert so the queue stays clean and
  // the shul-level "ANY-good source" reduction in admin-state.ts correctly
  // ignores this row.
  const isFailed = args.extractionStrategy === "failed";
  const effectiveReviewStatus: ReviewStatus = isFailed
    ? "rejected"
    : (args.reviewStatus ?? "pending");
  const effectiveReviewerNotes = isFailed
    ? "auto-rejected: cascade returned no useful rules"
    : null;

  // ─── Fix Q' — first_broken_at writer ────────────────────────────────
  // On insert, if lastRunStatus is broken/error, stamp first_broken_at
  // so the weekly digest's NEW-vs-CHRONIC split works from day one.
  const isBrokenAtInsert =
    args.lastRunStatus === "broken" || args.lastRunStatus === "error";

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
      reviewStatus: effectiveReviewStatus,
      ...(effectiveReviewerNotes ? { reviewerNotes: effectiveReviewerNotes } : {}),
      ...(isBrokenAtInsert ? { firstBrokenAt: args.lastRunAt } : {}),
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

  return { dataSourceId, rulesInserted, supersededDataSourceId };
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
