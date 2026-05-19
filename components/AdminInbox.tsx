import Link from "next/link";
import {
  adminShulStateLabel,
  adminShulStateTier,
  deriveAdminShulState,
  type AdminShulState,
} from "@/lib/admin-state";
import { FreshnessBadge } from "@/components/badges/FreshnessBadge";
import { formatRelativeDays } from "@/lib/format";
import type { AdminShulRow } from "@/lib/queries";

interface Props {
  rows: AdminShulRow[];
  /** Empty-state message when no rows. */
  emptyMessage?: string;
}

/**
 * Inbox-style row list. One row per shul. Verb-first label —
 * "Review 2 new extractions" beats "pending_review · 2 sources".
 *
 * Drives:
 *   - /admin (top-level dashboard, all non-active/archived shuls)
 *   - /admin/queue (filtered to pending_review)
 *   - /admin/rejected (filtered to no_good_source)
 *
 * Click a row → /admin/shul/[slug]. Data_source detail still lives at
 * /admin/data-source/[id] but isn't a listing destination anymore.
 */
export function AdminInbox({ rows, emptyMessage }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
        {emptyMessage ?? "Nothing here."}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const state = deriveAdminShulState(r);
        return <AdminInboxRow key={r.id} row={r} state={state} />;
      })}
    </ul>
  );
}

function AdminInboxRow({
  row,
  state,
}: {
  row: AdminShulRow;
  state: AdminShulState;
}) {
  const tier = adminShulStateTier(state);
  const verb = adminShulStateLabel(state, row);
  const tierStyles: Record<string, string> = {
    blocked: "border-l-4 border-l-neutral-300",
    broken: "border-l-4 border-l-rose-400",
    pending: "border-l-4 border-l-amber-400",
    ok: "border-l-4 border-l-emerald-400",
  };
  const verbStyles: Record<string, string> = {
    blocked: "text-neutral-600",
    broken: "text-rose-800",
    pending: "text-amber-900",
    ok: "text-emerald-800",
  };

  return (
    <li>
      <Link
        href={`/admin/shul/${row.slug}`}
        className={`block rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300 hover:bg-neutral-50 ${tierStyles[tier]}`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className={`truncate text-sm font-semibold ${verbStyles[tier]}`}>
              {verb}
            </div>
            <div className="mt-0.5 truncate font-medium text-neutral-900">
              {row.name}
            </div>
            {row.address && (
              <div className="truncate text-xs text-neutral-500">
                {row.address}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
            <FreshnessBadge lastFreshAt={row.lastFreshAt} />
            {/* "Broken since N days ago" badge — only renders when the
                shul is in a broken/no_good_source/stale tier AND has a
                first_broken_at timestamp. Helps admin distinguish
                fresh-this-week breakages from chronic ones at a glance. */}
            {tier === "broken" && row.firstBrokenAt && (
              <span
                className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] tracking-wide text-rose-700"
                title={`First broken: ${new Date(row.firstBrokenAt).toLocaleString()}`}
              >
                broken {formatRelativeDays(new Date(row.firstBrokenAt))}
              </span>
            )}
            {row.dataSourceCount > 0 && (
              <span className="text-neutral-400 tabular-nums">
                {row.dataSourceCount} source
                {row.dataSourceCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
