// The unified admin "mission-control" feed (server-only — imports db via the
// queries). Anchors the inbox on the two recurring admin jobs instead of the
// internal state enum:
//   NEW lane    — shuls that have NEVER gone live (hasApprovedSource = false):
//                 review their first extraction (or re-extract a failed first try).
//   BROKEN lane — shuls that WERE live and now have no healthy fresh source
//                 (hasApprovedSource = true): re-extract / fix.
// Plus two thin secondary areas: open wrong-time reports, and pending discovery
// candidates (approve-to-add → feeds the NEW lane).
//
// Dates are serialized to ISO strings here so feed items can cross the
// server→client boundary into the (client) inbox row components.

import {
  listAdminShuls,
  listOpenTimeReports,
  listPendingCandidates,
  type AdminShulRow,
} from "./queries";
import { deriveAdminShulState, isInboxState, type AdminShulState } from "./admin-state";

/** AdminShulRow with its Date fields flattened to ISO strings (client-safe). */
export type SerialAdminShulRow = Omit<
  AdminShulRow,
  "submittedAt" | "lastFreshAt" | "firstBrokenAt"
> & {
  submittedAt: string;
  lastFreshAt: string | null;
  firstBrokenAt: string | null;
};

export interface AdminFeedShulItem {
  kind: "shul";
  lane: "new" | "broken";
  /** Derived state — drives the row's label + primary action. */
  state: AdminShulState;
  shul: SerialAdminShulRow;
}

export interface AdminFeedReportItem {
  kind: "report";
  id: number;
  shulId: number;
  shulName: string;
  shulSlug: string;
  note: string | null;
  createdAt: string;
}

export interface AdminFeedCandidateItem {
  kind: "candidate";
  id: number;
  name: string;
  formattedAddress: string | null;
  websiteUri: string | null;
  discoveryTargetName: string | null;
  createdAt: string;
}

export interface AdminFeed {
  newItems: AdminFeedShulItem[];
  brokenItems: AdminFeedShulItem[];
  reports: AdminFeedReportItem[];
  candidates: AdminFeedCandidateItem[];
  counts: { new: number; broken: number; reports: number; candidates: number };
}

function serializeShulRow(row: AdminShulRow): SerialAdminShulRow {
  // NOTE: listAdminShuls runs a RAW db.execute(), so the Neon driver hands back
  // timestamp columns as STRINGS at runtime — the AdminShulRow `Date` typings are
  // an unchecked cast on the raw query, not a real Date. Calling `.toISOString()`
  // on a string threw "is not a function" and 500'd the whole inbox. Coerce via
  // `new Date(...)`, which is correct whether the value arrives as a string or a
  // Date. (Date methods elsewhere already wrap these in `new Date()`.)
  return {
    ...row,
    submittedAt: new Date(row.submittedAt).toISOString(),
    lastFreshAt: row.lastFreshAt ? new Date(row.lastFreshAt).toISOString() : null,
    firstBrokenAt: row.firstBrokenAt
      ? new Date(row.firstBrokenAt).toISOString()
      : null,
  };
}

export async function buildAdminFeed(): Promise<AdminFeed> {
  const [shuls, reports, candidates] = await Promise.all([
    // listAdminShuls is ORDER BY submitted_at DESC, so a too-low cap would drop
    // the OLDEST inbox shuls (e.g. a long-stuck broken one) from the feed +
    // counts. The inbox filters to non-active/non-archived states in JS after
    // the fetch, so this cap must comfortably exceed the whole directory. 5000
    // is far beyond foreseeable scale for this niche; if it's ever approached,
    // the real fix is a server-side inbox-state-filtered query.
    listAdminShuls({ q: null, status: null, limit: 5000 }),
    listOpenTimeReports(500),
    listPendingCandidates(500),
  ]);

  const newItems: AdminFeedShulItem[] = [];
  const brokenItems: AdminFeedShulItem[] = [];
  for (const row of shuls) {
    const state = deriveAdminShulState(row);
    if (!isInboxState(state)) continue; // active + archived never hit the inbox
    // The discriminator: ever-approved ⇒ "was live, now broke"; otherwise "new".
    const lane: "new" | "broken" = row.hasApprovedSource ? "broken" : "new";
    const item: AdminFeedShulItem = { kind: "shul", lane, state, shul: serializeShulRow(row) };
    (lane === "new" ? newItems : brokenItems).push(item);
  }

  // NEW: oldest submission first (slowest-to-be-reviewed on top).
  newItems.sort(
    (a, b) => Date.parse(a.shul.submittedAt) - Date.parse(b.shul.submittedAt),
  );
  // BROKEN: most-recent breakage first (this week's fails before chronic ones).
  brokenItems.sort((a, b) => brokenSortKey(b) - brokenSortKey(a));

  const reportItems: AdminFeedReportItem[] = reports.map((r) => ({
    kind: "report",
    id: r.id,
    shulId: r.shulId,
    shulName: r.shulName,
    shulSlug: r.shulSlug,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));

  const candidateItems: AdminFeedCandidateItem[] = candidates.map((c) => ({
    kind: "candidate",
    id: c.id,
    name: c.name,
    formattedAddress: c.formattedAddress,
    websiteUri: c.websiteUri,
    discoveryTargetName: c.discoveryTargetName,
    createdAt: c.createdAt.toISOString(),
  }));

  return {
    newItems,
    brokenItems,
    reports: reportItems,
    candidates: candidateItems,
    counts: {
      new: newItems.length,
      broken: brokenItems.length,
      reports: reportItems.length,
      candidates: candidateItems.length,
    },
  };
}

function brokenSortKey(item: AdminFeedShulItem): number {
  if (item.shul.firstBrokenAt) return Date.parse(item.shul.firstBrokenAt);
  if (item.shul.lastFreshAt) return Date.parse(item.shul.lastFreshAt);
  return 0;
}
