import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource, shul } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Fix W: source-level rejected audit. Lists every data_source where
// `review_status='rejected'`, grouped by reason (auto-rejected failed
// vs superseded vs admin-rejected). Useful after the dedupe script
// (Fix B) marks many sources superseded — admin wants to audit what
// got demoted without browsing each shul individually.
//
// Note: this is a SOURCE-level view. The existing /admin/rejected
// page is a SHUL-level view (shuls whose every source is rejected,
// no good source). Different lens on the same data.

interface PageProps {
  searchParams: Promise<{
    reason?: string; // "auto-rejected" | "superseded" | "admin" | undefined
  }>;
}

export default async function AdminRejectedDataSourcesPage({
  searchParams,
}: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const reasonFilter = sp.reason?.trim() ?? null;

  // Filter by reviewer_notes prefix to bucket by reason. Simpler than a
  // separate "rejection_reason" column for now.
  let extraWhere = sql`1=1`;
  if (reasonFilter === "auto-rejected") {
    extraWhere = sql`${dataSource.reviewerNotes} ILIKE 'auto-rejected%'`;
  } else if (reasonFilter === "superseded") {
    extraWhere = sql`${dataSource.reviewerNotes} ILIKE 'superseded%'`;
  } else if (reasonFilter === "admin") {
    extraWhere = sql`${dataSource.reviewerNotes} ILIKE 'rejected by%'`;
  }

  const rows = await db
    .select({
      id: dataSource.id,
      kind: dataSource.kind,
      identifier: dataSource.identifier,
      extractionStrategy: dataSource.extractionStrategy,
      lastRunStatus: dataSource.lastRunStatus,
      reviewerNotes: dataSource.reviewerNotes,
      createdAt: dataSource.createdAt,
      updatedAt: dataSource.updatedAt,
      shulId: shul.id,
      shulSlug: shul.slug,
      shulName: shul.name,
    })
    .from(dataSource)
    .innerJoin(shul, eq(shul.id, dataSource.shulId))
    .where(sql`${dataSource.reviewStatus} = 'rejected' AND ${extraWhere}`)
    .orderBy(desc(dataSource.updatedAt))
    .limit(300);

  // Per-bucket counts for the filter pills.
  const countsRaw = await db.execute<{ bucket: string; n: number }>(sql`
    SELECT
      CASE
        WHEN reviewer_notes ILIKE 'auto-rejected%' THEN 'auto-rejected'
        WHEN reviewer_notes ILIKE 'superseded%' THEN 'superseded'
        WHEN reviewer_notes ILIKE 'rejected by%' THEN 'admin'
        ELSE 'other'
      END AS bucket,
      COUNT(*)::int AS n
    FROM data_source
    WHERE review_status = 'rejected'
    GROUP BY bucket
  `);
  const counts: Record<string, number> = {};
  for (const c of countsRaw.rows) counts[c.bucket] = c.n;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const filters: Array<{ key: string | null; label: string; n: number }> = [
    { key: null, label: "All", n: total },
    { key: "auto-rejected", label: "Auto-rejected (failed extraction)", n: counts["auto-rejected"] ?? 0 },
    { key: "superseded", label: "Superseded", n: counts["superseded"] ?? 0 },
    { key: "admin", label: "Admin-rejected", n: counts["admin"] ?? 0 },
  ];

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="text-2xl font-semibold">Rejected data sources</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Per-source audit view. Source-level dedupe + auto-reject artifacts
        live here. For shul-level &ldquo;no good source&rdquo; triage, see the{" "}
        <Link href="/admin" className="underline-offset-2 hover:underline">
          inbox (Broken lane)
        </Link>
        .
      </p>

      {/* Filter pills */}
      <section className="mt-4 flex flex-wrap gap-1.5">
        {filters.map((f) => {
          const active = (reasonFilter ?? null) === f.key;
          const href = f.key
            ? `/admin/data-sources/rejected?reason=${f.key}`
            : "/admin/data-sources/rejected";
          return (
            <Link
              key={f.key ?? "all"}
              href={href}
              className={`rounded-full border px-3 py-1 text-xs ${
                active
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              {f.label}
              <span className="ml-1 text-neutral-400">{f.n}</span>
            </Link>
          );
        })}
      </section>

      {/* List */}
      <section className="mt-6">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
            No rejected data sources match this filter.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-neutral-200 bg-white p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/shul/${r.shulSlug}`}
                      className="font-medium text-amber-800 underline-offset-2 hover:underline"
                    >
                      {r.shulName}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-neutral-500">
                      ds {r.id} · {r.kind}
                    </span>
                    <div className="mt-0.5 truncate text-xs text-neutral-600">
                      {r.identifier}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    {r.extractionStrategy && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600">
                        {r.extractionStrategy.replace(/_/g, " ")}
                      </span>
                    )}
                    <span className="tabular-nums text-neutral-500">
                      {new Date(r.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {r.reviewerNotes && (
                  <div className="mt-1 text-xs italic text-neutral-600">
                    {r.reviewerNotes}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
