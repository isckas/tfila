import Link from "next/link";
import { listAdminShuls, countByShulStatus } from "@/lib/queries";
import {
  adminShulStateLabel,
  deriveAdminShulState,
  type AdminShulState,
} from "@/lib/admin-state";
import { FreshnessBadge } from "@/components/badges/FreshnessBadge";
import {
  StatusBadge,
  SHUL_STATUS_LABELS,
} from "@/components/badges/StatusBadge";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string; status?: string; state?: string }>;
}

const ADMIN_STATES: AdminShulState[] = [
  "archived",
  "unsupported",
  "broken",
  "pending_review",
  "no_good_source",
  "awaiting_extraction",
  "stale",
  "active",
];

const STATUS_LABELS = SHUL_STATUS_LABELS;
// Raw shul.status filter values. `broken` dropped (L3) — it's a DEPRECATED
// status no code writes; the enum value is kept only for legacy rows. (The
// derived "broken" inbox state still lives in ADMIN_STATES above.)
const STATUSES = ["pending_review", "active", "archived", "unsupported"];

export default async function AdminShulsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const q = sp.q?.trim() || null;
  const status = sp.status?.trim() || null;
  const state = sp.state?.trim() as AdminShulState | undefined;
  const stateFilter = state && ADMIN_STATES.includes(state) ? state : null;

  const [shulsRaw, statusCounts] = await Promise.all([
    listAdminShuls({ q, status, limit: 500 }),
    countByShulStatus(),
  ]);

  // Derived-state filter happens in JS (after the SQL aggregates land).
  // This keeps listAdminShuls a single SQL call regardless of whether
  // the caller filters by raw status or by derived state.
  const shuls = stateFilter
    ? shulsRaw.filter((s) => deriveAdminShulState(s) === stateFilter)
    : shulsRaw;

  const total = statusCounts.reduce((sum, c) => sum + Number(c.n), 0);
  const countByStatus: Record<string, number> = {};
  for (const c of statusCounts) countByStatus[c.status] = Number(c.n);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="text-2xl font-semibold">All shuls</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {total} total — searchable + filterable.
        {stateFilter && (
          <>
            {" "}Filtered to{" "}
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium">
              {adminShulStateLabel(stateFilter, { pendingSourceCount: 0 })}
            </span>{" "}
            ({shuls.length} match{shuls.length === 1 ? "" : "es"})
            {" · "}
            <Link
              href="/admin/shuls"
              className="underline-offset-2 hover:underline"
            >
              clear
            </Link>
          </>
        )}
      </p>

      {/* ─── Status filter pills ─────────────────────────────── */}
      <div className="mt-5 flex flex-wrap gap-2 text-sm">
        <Link
          href={`/admin/shuls${q ? `?q=${encodeURIComponent(q)}` : ""}`}
          className={`rounded-full px-3 py-1 ${!status ? "bg-amber-800 text-white" : "border border-neutral-300 hover:bg-neutral-100"}`}
        >
          All <span className="ml-1 text-xs opacity-75">({total})</span>
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/shuls?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-full px-3 py-1 ${
              status === s
                ? "bg-amber-800 text-white"
                : "border border-neutral-300 hover:bg-neutral-100"
            }`}
          >
            {STATUS_LABELS[s] ?? s}{" "}
            <span className="ml-1 text-xs opacity-75">
              ({countByStatus[s] ?? 0})
            </span>
          </Link>
        ))}
      </div>

      {/* ─── Search box ──────────────────────────────────────── */}
      <form method="get" action="/admin/shuls" className="mt-4 flex gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by shul name or slug…"
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Search
        </button>
        {(q || status || stateFilter) && (
          <Link
            href="/admin/shuls"
            className="rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Clear
          </Link>
        )}
      </form>

      {/* ─── Table ───────────────────────────────────────────── */}
      <section className="mt-6">
        {shuls.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
            {q
              ? `No shuls matched "${q}".`
              : "No shuls found for this filter."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Freshness</th>
                  <th className="px-3 py-2 text-right tabular-nums">Rules</th>
                  <th className="px-3 py-2">Public URL</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {shuls.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-900">
                        <Link
                          href={`/admin/shul/${s.slug}`}
                          className="hover:text-amber-800 hover:underline underline-offset-2"
                        >
                          {s.name}
                        </Link>
                      </div>
                      {s.address && (
                        <div className="text-xs text-neutral-500">
                          {s.address}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={s.status} />
                      {s.primaryDataSourceReview === "pending" && (
                        <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                          unreviewed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <FreshnessBadge
                        lastFreshAt={s.lastFreshAt}
                        variant="full"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                      {s.liveRuleCount}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/shul/${s.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-amber-800 underline-offset-2 hover:underline"
                      >
                        /shul/{s.slug}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {s.submittedUrl ? (
                        <a
                          href={s.submittedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block max-w-[18rem] truncate text-xs text-neutral-600 underline-offset-2 hover:underline"
                          title={s.submittedUrl}
                        >
                          {s.submittedUrl}
                        </a>
                      ) : (
                        <span className="text-xs text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

