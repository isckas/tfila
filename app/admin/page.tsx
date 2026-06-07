import Link from "next/link";
import { listAdminShuls, countOpenTimeReports } from "@/lib/queries";
import {
  adminShulStateSortKey,
  deriveAdminShulState,
  isInboxState,
  type AdminShulState,
} from "@/lib/admin-state";
import { AdminInbox } from "@/components/AdminInbox";

export const dynamic = "force-dynamic";

/**
 * Admin landing — inbox-style. Counts at the top by state, then a list
 * of every shul that needs attention (not active, not archived). Click
 * any row → /admin/shul/[slug] for the full mission-control view.
 *
 * The /admin/queue and /admin/rejected pages are filtered views of the
 * same data; /admin/shuls remains the catalog of every shul (active or
 * not).
 */
export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state: stateParam } = await searchParams;
  // Pull a generous slice — most projects have a few hundred shuls at most.
  const shuls = await listAdminShuls({ q: null, status: null, limit: 500 });
  const openReports = await countOpenTimeReports();

  // Derive state per shul + bucket counts
  const withState = shuls.map((s) => ({
    row: s,
    state: deriveAdminShulState(s),
  }));
  const counts = bucketByState(withState.map((x) => x.state));

  // Inbox = needs-attention rows, sorted urgent-first.
  // Fix S: within the "broken" tier, sort by first_broken_at DESC so the
  // most-recent breakage floats to the top — admin sees this week's
  // fails first, chronic ones drop below.
  const inboxWithState = withState
    .filter((x) => isInboxState(x.state))
    .sort((a, b) => {
      const dk = adminShulStateSortKey(a.state) - adminShulStateSortKey(b.state);
      if (dk !== 0) return dk;
      // Within "broken" / "no_good_source" / "stale" tier, newer broken first.
      if (a.row.firstBrokenAt || b.row.firstBrokenAt) {
        const aT = a.row.firstBrokenAt
          ? new Date(a.row.firstBrokenAt).valueOf()
          : 0;
        const bT = b.row.firstBrokenAt
          ? new Date(b.row.firstBrokenAt).valueOf()
          : 0;
        if (aT !== bT) return bT - aT;
      }
      // Other tiers: prefer oldest signal (lowest lastFreshAt or oldest submittedAt)
      const at = (a.row.lastFreshAt ?? a.row.submittedAt).valueOf();
      const bt = (b.row.lastFreshAt ?? b.row.submittedAt).valueOf();
      return at - bt;
    });

  const totalActive = counts.active;
  const totalArchived = counts.archived;
  const inboxTotal = inboxWithState.length;

  // UI-5: filter chips filter the inbox on THIS page (absorbing the old
  // /queue + /rejected routes + the 8-tile wall) rather than linking out.
  const activeChip =
    stateParam && stateParam !== "all" ? stateParam : "all";
  const displayedRows = (
    activeChip === "all"
      ? inboxWithState
      : inboxWithState.filter((x) => x.state === activeChip)
  ).map((x) => x.row);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {inboxTotal} shul{inboxTotal === 1 ? "" : "s"} need attention ·{" "}
        {totalActive} active · {totalArchived} archived
      </p>

      {/* E-B5: user wrong-time reports awaiting triage. */}
      {openReports > 0 && (
        <Link
          href="/admin/reports"
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
        >
          🚩 {openReports} wrong-time report{openReports === 1 ? "" : "s"} to
          review →
        </Link>
      )}

      {/* ─── Inbox filter chips (UI-5) ───────────────────────── */}
      {/* Collapses the old 8-tile wall + the /queue + /rejected routes into
          one chip row that filters the inbox in place via ?state=. Only chips
          with rows are shown. "All shuls" / Active live in the shortcuts. */}
      <section className="mt-6 flex flex-wrap gap-1.5">
        <InboxChip label="All" count={inboxTotal} state="all" active={activeChip} />
        {INBOX_CHIPS.filter((c) => counts[c.state] > 0).map((c) => (
          <InboxChip
            key={c.state}
            label={c.label}
            count={counts[c.state]}
            state={c.state}
            active={activeChip}
          />
        ))}
      </section>

      {/* ─── Inbox ───────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">
          {activeChip === "all"
            ? "Inbox — shuls needing attention"
            : `Filtered — ${displayedRows.length} shul${displayedRows.length === 1 ? "" : "s"}`}
        </h2>
        <AdminInbox
          rows={displayedRows}
          emptyMessage={
            activeChip === "all"
              ? "✓ All clear. No shuls currently need attention."
              : "Nothing in this filter."
          }
        />
      </section>

      {/* ─── Other shortcuts ─────────────────────────────────── */}
      <section className="mt-8 text-xs text-neutral-500">
        <Link href="/admin/shuls" className="underline-offset-2 hover:underline">
          All shuls ({shuls.length}) →
        </Link>
        {" · "}
        <Link
          href="/admin/shuls?status=active"
          className="underline-offset-2 hover:underline"
        >
          Active ({totalActive}) →
        </Link>
        {" · "}
        <Link href="/admin/reports" className="underline-offset-2 hover:underline">
          Wrong-time reports →
        </Link>
        {" · "}
        <Link href="/admin/candidates" className="underline-offset-2 hover:underline">
          Discovery candidates →
        </Link>
        {" · "}
        <Link href="/admin/changelog" className="underline-offset-2 hover:underline">
          Changelog →
        </Link>
        {" · "}
        <Link href="/" className="underline-offset-2 hover:underline">
          Public feed →
        </Link>
      </section>
    </div>
  );
}

function bucketByState(states: AdminShulState[]): Record<AdminShulState, number> {
  const init: Record<AdminShulState, number> = {
    archived: 0,
    unsupported: 0,
    broken: 0,
    pending_review: 0,
    no_good_source: 0,
    awaiting_extraction: 0,
    stale: 0,
    active: 0,
  };
  for (const s of states) init[s]++;
  return init;
}

// Inbox states surfaced as filter chips (UI-5), in triage order. Only chips
// with a non-zero count render. 'active'/'archived' aren't inbox states.
const INBOX_CHIPS: { state: AdminShulState; label: string }[] = [
  { state: "pending_review", label: "Review" },
  { state: "broken", label: "Broken" },
  { state: "no_good_source", label: "No source" },
  { state: "stale", label: "Stale" },
  { state: "awaiting_extraction", label: "Awaiting" },
  { state: "unsupported", label: "Unsupported" },
];

function InboxChip({
  label,
  count,
  state,
  active,
}: {
  label: string;
  count: number;
  state: string;
  active: string;
}) {
  const isActive = active === state;
  return (
    <Link
      href={state === "all" ? "/admin" : `/admin?state=${state}`}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-400 ${
        isActive
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
      }`}
    >
      {label}
      <span
        className={`tabular-nums ${isActive ? "text-neutral-300" : "text-neutral-400"}`}
      >
        {count}
      </span>
    </Link>
  );
}
