import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { shul, shulCandidate } from "@/db/schema";
import targetsJson from "@/data/discovery-targets.json";

export const dynamic = "force-dynamic";

const ALL_TARGETS = (targetsJson as { targets: Array<{ name: string; region: string; tier: number }> }).targets;

interface PageProps {
  searchParams: Promise<{
    status?: string;
    target?: string;
    // Result banner params from POST /api/admin/discovery/run
    ran?: string;
    new?: string;
    dup?: string;
    queries?: string;
    errors?: string;
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

const STATUS_BADGE_SHUL: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-900",
  pending_review: "bg-amber-100 text-amber-900",
  broken: "bg-rose-100 text-rose-900",
  archived: "bg-neutral-200 text-neutral-700",
  unsupported: "bg-rose-100 text-rose-800",
  no_url: "bg-amber-100 text-amber-900",
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

  // Recently approved (last 24h) with current shul state — lets the admin
  // track in-flight extractions without bouncing to /admin/shuls.
  const recent = await db
    .select({
      candidateId: shulCandidate.id,
      reviewedAt: shulCandidate.reviewedAt,
      reviewStatus: shulCandidate.reviewStatus,
      shulId: shul.id,
      shulSlug: shul.slug,
      shulName: shul.name,
      shulStatus: shul.status,
      shulHasAddress: sql<boolean>`${shul.address} IS NOT NULL`,
      shulHasUrl: sql<boolean>`${shul.submittedUrl} IS NOT NULL`,
    })
    .from(shulCandidate)
    .innerJoin(shul, eq(shulCandidate.linkedShulId, shul.id))
    .where(sql`${shulCandidate.reviewedAt} > NOW() - INTERVAL '24 hours'`)
    .orderBy(desc(shulCandidate.reviewedAt))
    .limit(20);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="text-2xl font-semibold">Discovery candidates</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Places-returned candidates pending review. Approve creates a real
        shul + queues extraction. Reject removes from the queue but keeps
        the row so re-runs skip it.
      </p>

      {/* Banner after a discovery run */}
      {sp.ran && (
        <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
          Number(sp.errors ?? "0") > 0
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : "border-emerald-300 bg-emerald-50 text-emerald-900"
        }`}>
          ✓ Ran discovery for <strong>{sp.ran}</strong>:{" "}
          {sp.new} new, {sp.dup} duplicate, {sp.queries} queries
          {Number(sp.errors ?? "0") > 0 && ` · ${sp.errors} errored`}.
          New candidates will appear below under <code>pending</code>.
        </div>
      )}

      {/* Run discovery picker */}
      <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-700">
          Run discovery
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Hits Google Places Text Search for the picked target. ~3
          queries per target, ~$0.10 per run. Idempotent on{" "}
          <code>place_id</code> — re-running re-finds existing candidates
          without creating duplicates.
        </p>
        <form
          method="post"
          action="/api/admin/discovery/run"
          className="mt-3 flex flex-wrap items-center gap-2 text-sm"
        >
          <select
            name="target"
            defaultValue=""
            required
            className="min-w-[260px] rounded border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              — pick a target —
            </option>
            <optgroup label="North America (Tier 1)">
              {ALL_TARGETS.filter((t) => t.region === "north_america" && t.tier === 1).map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="North America (Tier 2)">
              {ALL_TARGETS.filter((t) => t.region === "north_america" && t.tier === 2).map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Europe">
              {ALL_TARGETS.filter((t) => t.region === "europe").map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Travel destinations">
              {ALL_TARGETS.filter((t) => t.region === "travel").map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            type="submit"
            className="rounded bg-amber-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-900"
          >
            Run
          </button>
          <span className="text-xs text-neutral-500">
            Takes ~10-20 seconds.
          </span>
        </form>
      </section>

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

      {/* Recently approved (last 24h) */}
      {recent.length > 0 && (
        <section className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            Recently approved · last 24h ({recent.length})
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Pipeline state for each. Click through to review extracted
            rules. <code>no_url</code> shuls won&apos;t publish until a
            URL is added on the shul page.
          </p>
          <ul className="mt-3 space-y-1.5">
            {recent.map((r) => (
              <li key={r.candidateId} className="flex flex-wrap items-baseline gap-2 text-xs">
                <Link
                  href={`/admin/shul/${r.shulSlug}`}
                  className="font-medium text-amber-800 underline-offset-2 hover:underline"
                >
                  {r.shulName}
                </Link>
                <span className={`rounded px-1.5 py-0.5 ${STATUS_BADGE_SHUL[r.shulStatus] ?? "bg-neutral-100 text-neutral-700"}`}>
                  {r.shulStatus.replace(/_/g, " ")}
                </span>
                {!r.shulHasAddress && (
                  <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-800">no address</span>
                )}
                {!r.shulHasUrl && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">no url</span>
                )}
                <span className="text-neutral-500">
                  {r.reviewedAt
                    ? new Date(r.reviewedAt).toLocaleString([], {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
                    {c.websiteUri ? (
                      <a
                        href={c.websiteUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 block max-w-full truncate text-xs text-amber-800 underline-offset-2 hover:underline"
                      >
                        {c.websiteUri}
                      </a>
                    ) : (
                      c.reviewStatus === "pending" && (
                        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 ring-1 ring-amber-200">
                          ⚠ No website from Places. Paste one to extract
                          times, or approve as <code>no_url</code> to track
                          the address without publishing (tfila.co only
                          lists shuls with live times).
                        </p>
                      )
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
                      {c.websiteUri ? (
                        <form method="post" action={`/api/admin/candidate/${c.id}/approve`} className="inline">
                          <button
                            type="submit"
                            className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                            title="Creates shul + queues extraction from the Places-returned website"
                          >
                            Approve (extract times)
                          </button>
                        </form>
                      ) : (
                        <ApproveNoUrlForm candidateId={c.id} />
                      )}
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

function ApproveNoUrlForm({ candidateId }: { candidateId: number }) {
  // Two actions live in the same form. The "Approve with URL" button
  // submits with the urlOverride field; "Approve as no_url" submits
  // without it (server falls through to creating a no_url shul).
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800">
        Approve…
      </summary>
      <form
        method="post"
        action={`/api/admin/candidate/${candidateId}/approve`}
        className="absolute right-0 z-10 mt-1 w-72 space-y-3 rounded-xl border border-neutral-300 bg-white p-3 shadow-lg"
      >
        <div>
          <label className="block text-xs font-medium text-neutral-700">
            Shul website URL (optional)
          </label>
          <input
            type="text"
            name="urlOverride"
            placeholder="https://example-shul.org"
            className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            Paste a URL to extract times. Leave blank to track address
            only (won&apos;t publish).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="flex-1 rounded bg-emerald-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
            title="With a URL → extracts times. Without → creates no_url shul (not published)."
          >
            Approve
          </button>
        </div>
      </form>
    </details>
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
