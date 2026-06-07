// Derive a single per-shul "next action" state from raw shul + data_source
// flags. The admin inbox renders one row per shul keyed off this state, so
// a shul with multiple data_sources never appears more than once.
//
// Order matters — first match wins. Most-blocking states first
// (archived/unsupported), then triage, then health.

import { STALE_THRESHOLD_DAYS } from "./freshness";
import type { AdminShulRow } from "./queries";

export type AdminShulState =
  | "archived"
  | "unsupported"
  | "broken"
  | "pending_review"
  | "no_good_source"
  | "awaiting_extraction"
  | "stale"
  | "active";

/**
 * In-app state name → display verb. The inbox shows the verb so the
 * admin reads "what to do," not "what state it's in."
 *
 * `count` is filled in by the caller for states whose label is
 * cardinality-aware (e.g. "Review N new extractions").
 */
export function adminShulStateLabel(
  state: AdminShulState,
  row: Pick<AdminShulRow, "pendingSourceCount">,
): string {
  switch (state) {
    case "archived":
      return "Archived";
    case "unsupported":
      return "Try a different source URL";
    case "broken":
      return "Investigate broken extraction";
    case "pending_review": {
      const n = row.pendingSourceCount;
      return n === 1
        ? "Review 1 new extraction"
        : `Review ${n} new extractions`;
    }
    case "no_good_source":
      return "No good source — triage";
    case "awaiting_extraction":
      return "Awaiting extraction";
    case "stale":
      return `Stale — re-extract (${STALE_THRESHOLD_DAYS}d+)`;
    case "active":
      return "Active";
  }
}

/** Visual tier — drives the row's color band in the inbox UI. */
export type AdminShulTier =
  | "blocked" // archived/unsupported — needs attention but low frequency
  | "broken" // urgent — extraction is failing or stale
  | "pending" // routine review work
  | "ok"; // healthy

export function adminShulStateTier(state: AdminShulState): AdminShulTier {
  switch (state) {
    case "archived":
    case "unsupported":
      return "blocked";
    case "broken":
    case "no_good_source":
    case "stale":
      return "broken";
    case "pending_review":
    case "awaiting_extraction":
      return "pending";
    case "active":
      return "ok";
  }
}

/**
 * Derive the next-action state from a shul row + its aggregated
 * data_source flags. Order-priority — the first matching rule wins.
 */
export function deriveAdminShulState(
  row: Pick<
    AdminShulRow,
    | "status"
    | "dataSourceCount"
    | "hasPendingSource"
    | "hasApprovedSource"
    | "hasRejectedSource"
    | "hasBrokenRun"
    | "lastFreshAt"
  >,
): AdminShulState {
  if (row.status === "archived") return "archived";
  if (row.status === "unsupported") return "unsupported";

  // E-F1: a reviewable PENDING extraction outranks "broken". The query's
  // has_pending_source already excludes strategy='failed' zombies (Fix T), so
  // this only fires for a genuinely reviewable extraction — a shul whose ONLY
  // pending source is a failed extraction has has_pending_source=false and
  // still falls through to "broken" below (so M14 doesn't regress). Without
  // this order, every shul that had both a broken run AND a fresh pending
  // extraction was mislabeled "broken" and never appeared in the review queue
  // (verified: it hid all reviewable shuls).
  if (row.hasPendingSource) return "pending_review";

  // Broken: no approved+ok+fresh source exists (query aggregates this as
  // has_broken_run), or the shul row is flagged broken. Live signal even when
  // shul.status hasn't been pushed to 'broken'.
  if (row.status === "broken" || row.hasBrokenRun) return "broken";

  // No data_sources at all — extraction hasn't fired (or just hasn't
  // landed). Will resolve itself when the Inngest job completes.
  if (row.dataSourceCount === 0) return "awaiting_extraction";

  // Only rejected, no approved → admin needs to find a better source.
  if (row.hasRejectedSource && !row.hasApprovedSource) return "no_good_source";

  // Stale gate (matches the public-facing freshness threshold).
  const daysSinceFresh =
    row.lastFreshAt == null
      ? null
      : Math.floor(
          (Date.now() - new Date(row.lastFreshAt).getTime()) / 86_400_000,
        );
  if (
    row.hasApprovedSource &&
    (daysSinceFresh == null || daysSinceFresh >= STALE_THRESHOLD_DAYS)
  ) {
    return "stale";
  }

  // Active = approved sources + fresh.
  if (row.hasApprovedSource) return "active";

  // Edge fallback: shouldn't happen given the rules above, but better to
  // bucket as "no good source" than render undefined.
  return "no_good_source";
}

/** True for states that should appear in the "needs attention" inbox. */
export function isInboxState(state: AdminShulState): boolean {
  return state !== "active" && state !== "archived";
}

/**
 * Sort key for inbox ordering — most-urgent first. Lower number = more
 * urgent. Within a tier, the caller can secondary-sort (e.g. by oldest
 * pending or newest broken).
 */
export function adminShulStateSortKey(state: AdminShulState): number {
  switch (state) {
    case "broken":
      return 0;
    case "no_good_source":
      return 1;
    case "stale":
      return 2;
    case "pending_review":
      return 3;
    case "awaiting_extraction":
      return 4;
    case "unsupported":
      return 5;
    case "archived":
      return 6;
    case "active":
      return 7;
  }
}
