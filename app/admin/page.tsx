import Link from "next/link";
import { listAdminShuls } from "@/lib/queries";
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
export default async function AdminHomePage() {
  // Pull a generous slice — most projects have a few hundred shuls at most.
  const shuls = await listAdminShuls({ q: null, status: null, limit: 500 });

  // Derive state per shul + bucket counts
  const withState = shuls.map((s) => ({
    row: s,
    state: deriveAdminShulState(s),
  }));
  const counts = bucketByState(withState.map((x) => x.state));

  // Inbox = needs-attention rows, sorted urgent-first then by oldest pending
  const inbox = withState
    .filter((x) => isInboxState(x.state))
    .sort((a, b) => {
      const dk = adminShulStateSortKey(a.state) - adminShulStateSortKey(b.state);
      if (dk !== 0) return dk;
      // Within state: prefer oldest signal (lowest lastFreshAt or oldest submittedAt)
      const at = (a.row.lastFreshAt ?? a.row.submittedAt).valueOf();
      const bt = (b.row.lastFreshAt ?? b.row.submittedAt).valueOf();
      return at - bt;
    })
    .map((x) => x.row);

  const totalActive = counts.active;
  const totalArchived = counts.archived;
  const inboxTotal = inbox.length;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {inboxTotal} shul{inboxTotal === 1 ? "" : "s"} need attention ·{" "}
        {totalActive} active · {totalArchived} archived
      </p>

      {/* ─── Tile counts by state (clickable filters) ────────── */}
      <section className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label="Broken"
          n={counts.broken}
          href="/admin/shuls?state=broken"
          tone="rose"
        />
        <Tile
          label="No good source"
          n={counts.no_good_source}
          href="/admin/rejected"
          tone="rose"
        />
        <Tile
          label="Pending review"
          n={counts.pending_review}
          href="/admin/queue"
          tone="amber"
        />
        <Tile
          label="Stale"
          n={counts.stale}
          href="/admin/shuls?state=stale"
          tone="rose"
        />
        <Tile
          label="Awaiting extraction"
          n={counts.awaiting_extraction}
          href="/admin/shuls?state=awaiting_extraction"
          tone="amber"
        />
        <Tile
          label="Unsupported"
          n={counts.unsupported}
          href="/admin/shuls?status=unsupported"
          tone="neutral"
        />
        <Tile
          label="Active (fresh)"
          n={counts.active}
          href="/admin/shuls?status=active"
          tone="emerald"
        />
        <Tile
          label="All shuls"
          n={shuls.length}
          href="/admin/shuls"
          tone="neutral"
        />
      </section>

      {/* ─── Inbox ───────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">
          Inbox — shuls needing attention
        </h2>
        <AdminInbox
          rows={inbox}
          emptyMessage="✓ All clear. No shuls currently need attention."
        />
      </section>

      {/* ─── Other shortcuts ─────────────────────────────────── */}
      <section className="mt-8 text-xs text-neutral-500">
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

function Tile({
  label,
  n,
  href,
  tone,
}: {
  label: string;
  n: number;
  href: string;
  tone: "rose" | "amber" | "emerald" | "neutral";
}) {
  const styles: Record<string, string> = {
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    neutral: "border-neutral-200 bg-white text-neutral-900",
  };
  const dim = n === 0 ? "opacity-60" : "";
  return (
    <Link
      href={href}
      className={`block rounded-xl border px-3 py-3 hover:shadow-sm ${styles[tone]} ${dim}`}
    >
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{n}</div>
    </Link>
  );
}
