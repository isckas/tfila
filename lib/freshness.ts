// "No stale data" gate. FEATURES.md "No stale data: only list shuls
// with fresh verified tfila times" — locks the central product promise
// in code: a shul is only visible to public daveners (home-page feed,
// fuzzy search, /shul/[slug]) when at least one of its data_sources
// has had a successful run within STALE_THRESHOLD_DAYS.
//
// Architecture: query-time filtering (vs a stored "stale" status). Easier
// to undo, no migration needed, threshold tunable in one place.

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { dataSource } from "../db/schema";

/** Public queries hide shuls whose newest fresh data_source is older. */
export const STALE_THRESHOLD_DAYS = 14;

/** Admin pill turns amber when freshness drops below this — early warning. */
export const STALE_WARNING_DAYS = 10;

/**
 * Inline SQL fragment for the freshness predicate. Each public-facing
 * query embeds this verbatim — the indirection isn't worth a wrapper.
 *
 *   AND EXISTS (
 *     SELECT 1 FROM data_source ds_fresh
 *     WHERE ds_fresh.shul_id = <shul-id-ref>
 *       AND ds_fresh.last_run_status = 'ok'
 *       AND COALESCE(ds_fresh.last_received_at, ds_fresh.last_run_at) >=
 *           NOW() - INTERVAL '14 days'
 *   )
 *
 * If you change STALE_THRESHOLD_DAYS, update the inline INTERVAL literals
 * too — they're hardcoded at each call site for readable EXPLAIN output.
 */

/**
 * Slug-page check: does this shul have any fresh data_source? Returns
 * false → render the "we don't have current times" variant (FEATURES.md
 * option C). True → render the normal schedule.
 *
 * Fix P: source must also be `review_status='approved'`. A `pending`
 * source whose `last_run_status='broken'` was previously treated as
 * fresh (because last_run_at was recent), which displayed stale rules
 * publicly while the re-extraction sat waiting for admin review.
 * Constraining to approved+ok closes that gap — the public feed only
 * shows shuls whose CURRENT canonical extraction succeeded.
 */
export async function hasFreshDataSourceForShul(
  shulId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: dataSource.id })
    .from(dataSource)
    .where(
      and(
        eq(dataSource.shulId, shulId),
        eq(dataSource.lastRunStatus, "ok"),
        eq(dataSource.reviewStatus, "approved"),
        sql`COALESCE(${dataSource.lastReceivedAt}, ${dataSource.lastRunAt}) >=
            NOW() - (${STALE_THRESHOLD_DAYS} || ' days')::interval`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Admin-pill input: days since the most recent successful run across
 * all of this shul's data_sources. Returns null when no successful
 * run has ever happened (gray pill). Used by /admin/shuls.
 */
export function shulFreshnessTier(daysSinceLastFresh: number | null):
  | "fresh"
  | "warning"
  | "stale"
  | "never" {
  if (daysSinceLastFresh == null) return "never";
  if (daysSinceLastFresh < STALE_WARNING_DAYS) return "fresh";
  if (daysSinceLastFresh < STALE_THRESHOLD_DAYS) return "warning";
  return "stale";
}
