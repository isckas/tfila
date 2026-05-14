import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { shulCandidate } from "@/db/schema";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    status?: string;
    target?: string;
  }>;
}

const STATUSES = ["pending", "approved", "rejected", "duplicate", "deferred"];

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  duplicate: "bg-neutral-200 text-neutral-700",
  deferred: "bg-blue-100 text-blue-900",
};

export default async function AdminCandidatesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const status = sp.status?.trim() || "pending";
  const target = sp.target?.trim() || null;

  // Per-status counts for the filter pills
  const countsRaw = await db.execute<{ review_status: string; n: number }>(sql`
    SELECT review_status, COUNT(*)::int AS n
      FROM shul_candidate
      GROUP BY review_status
  `);
  const counts: Record<string, number> = {};
  for (const row of countsRaw.rows) counts[row.review_status] = row.n;

  // Distinct target names for the target filter dropdown
  const targetsRaw = await db.execute<{ discovery_target_name: string; n: number }>(sql`
    SELECT discovery_target_name, COUNT(*)::int AS n
      FROM shul_candidate
      WHERE discovery_target_name IS NOT NULL
      GROUP BY discovery_target_name
      ORDER BY n DESC
  `);

  // Build WHERE conditions
  const conditions = [eq(shulCandidate.reviewStatus, status)];
  if (target) conditions.push(eq(shulCandidate.discoveryTargetName, target));

  const candidates = await db
    .select({
      id: shulCandidate.id,
      placeId: shulCandidate.placeId,
      name: shulCandidate.name,
      formattedAddress: shulCandidate.formattedAddress,
      websiteUri: shulCandidate.websiteUri,
      types: shulCandidate.types,
      discoveryTargetName: shulCandidate.discoveryTargetName,
      reviewStatus: shulCandidate.reviewStatus,
      reviewReason: shulCandidate.reviewReason,
      linkedShulId: shulCandidate.linkedShulId,
      createdAt: shulCandidate.createdAt,
    })
    .from(shulCandidate)
    .where(and(...conditions))
    .orderBy(desc(shulCandidate.createdAt))
    .limit(200);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="text-2xl font-semibold">Discovery candidates</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Places-returned candidates pending review. Approve creates a real
        shul + queues extraction. Reject removes from the queue but keeps
        the row so re-runs skip it.
      </p>

      {/* Status filter pills */}
      <div className="mt-5 flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => {
          const qs = new URLSearchParams();
          qs.set("status", s);
          if (target) qs.set("target", target);
          return (
            <Link
              key={s}
              href={`/admin/candidates?${qs.toString()}`}
              className={`rounded-full px-3 py-1 ${
                status === s
                  ? "bg-amber-800 text-white"
                  : "border border-neutral-300 hover:bg-neutral-100"
              }`}
            >
              {s}
              <span className="ml-1 text-xs opacity-75">({counts[s] ?? 0})</span>
            </Link>
          );
        })}
      </div>

      {/* Target filter */}
      {targetsRaw.rows.length > 0 && (
        <form method="get" action="/admin/candidates" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="status" value={status} />
          <label className="text-xs text-neutral-600">Target:</label>
          <select
            name="target"
            defaultValue={target ?? ""}
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="">— all —</option>
            {targetsRaw.rows.map((r) => (
              <option key={r.discovery_target_name} value={r.discovery_target_name}>
                {r.discovery_target_name} ({r.n})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800"
          >
            Apply
          </button>
          {target && (
            <Link
              href={`/admin/candidates?status=${status}`}
              className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
            >
              Clear
            </Link>
          )}
        </form>
      )}

      {/* Candidate list */}
      <section className="mt-6">
        {candidates.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
            No candidates with status &quot;{status}&quot;
            {target ? ` for target "${target}"` : ""}.
          </div>
        ) : (
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-neutral-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-neutral-900">{c.name}</h2>
                    {c.formattedAddress && (
                      <p className="mt-0.5 text-sm text-neutral-600">
                        {c.formattedAddress}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 ${STATUS_BADGE[c.reviewStatus] ?? "bg-neutral-100"}`}>
                        {c.reviewStatus}
                      </span>
                      {c.discoveryTargetName && (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-700">
                          {c.discoveryTargetName}
                        </span>
                      )}
                      {(c.types ?? []).map((t) => (
                        <span
                          key={t}
                          className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-neutral-700"
                        >
                          {t}
                        </span>
                      ))}
                      {c.linkedShulId && (
                        <Link
                          href={`/admin/shul/${c.linkedShulId}`}
                          className="text-amber-800 underline-offset-2 hover:underline"
                        >
                          → shul #{c.linkedShulId}
                        </Link>
                      )}
                    </div>
                    {c.websiteUri && (
                      <a
                        href={c.websiteUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 block max-w-full truncate text-xs text-amber-800 underline-offset-2 hover:underline"
                      >
                        {c.websiteUri}
                      </a>
                    )}
                    {c.reviewReason && (
                      <p className="mt-1 text-xs italic text-neutral-500">
                        Reason: {c.reviewReason}
                      </p>
                    )}
                  </div>

                  {/* Actions — only show on pending */}
                  {c.reviewStatus === "pending" && (
                    <div className="flex shrink-0 items-center gap-2">
                      <form method="post" action={`/api/admin/candidate/${c.id}/approve`} className="inline">
                        <button
                          type="submit"
                          className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                        >
                          Approve
                        </button>
                      </form>
                      <RejectForm candidateId={c.id} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RejectForm({ candidateId }: { candidateId: number }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded border border-rose-300 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50">
        Reject
      </summary>
      <form
        method="post"
        action={`/api/admin/candidate/${candidateId}/reject`}
        className="absolute right-0 z-10 mt-1 w-64 rounded-xl border border-neutral-300 bg-white p-3 shadow-lg"
      >
        <label className="block text-xs font-medium text-neutral-700">
          Reason
          <input
            type="text"
            name="reason"
            placeholder="not a shul / chabad house / duplicate of …"
            className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
            required
          />
        </label>
        <button
          type="submit"
          className="mt-2 w-full rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
        >
          Confirm reject
        </button>
      </form>
    </details>
  );
}
