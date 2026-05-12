import Link from "next/link";
import { notFound } from "next/navigation";
import { getShulForAdmin, getRecentScrapeRunsForShul } from "@/lib/queries";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending_review: "Pending review",
  active: "Active",
  broken: "Broken",
  archived: "Archived",
};

export default async function AdminShulDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getShulForAdmin(slug);
  if (!data) notFound();

  const { shul: s, dataSources } = data;
  const runs = await getRecentScrapeRunsForShul(s.id, 15);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <Link
        href="/admin/shuls"
        className="text-xs text-neutral-500 hover:underline"
      >
        ← all shuls
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-neutral-900">{s.name}</h1>
      <p className="text-sm text-neutral-600">
        {s.address ?? <span className="italic">no address</span>}
        {s.lat != null && s.lng != null && (
          <span className="ml-2 tabular-nums text-neutral-400">
            ({s.lat.toFixed(4)}, {s.lng.toFixed(4)})
          </span>
        )}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <StatusPill status={s.status} />
        {s.timezone && (
          <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-neutral-700">
            {s.timezone}
          </span>
        )}
        {s.nusach && (
          <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800">
            {s.nusach}
          </span>
        )}
        <Link
          href={`/shul/${s.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-2 text-amber-800 underline-offset-2 hover:underline"
        >
          public page →
        </Link>
      </div>

      {/* ─── Edit shul metadata ──────────────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Edit metadata
        </h2>
        <form
          method="post"
          action={`/api/admin/shul/${s.id}/edit`}
          className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Name</span>
              <input
                type="text"
                name="name"
                defaultValue={s.name}
                required
                className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Timezone
              </span>
              <input
                type="text"
                name="timezone"
                defaultValue={s.timezone ?? ""}
                placeholder="America/New_York"
                className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-xs font-medium text-neutral-600">Address</span>
              <input
                type="text"
                name="address"
                defaultValue={s.address ?? ""}
                className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Nusach
              </span>
              <input
                type="text"
                name="nusach"
                defaultValue={s.nusach ?? ""}
                placeholder="Ashkenaz / Sefard / etc"
                className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Contact email
              </span>
              <input
                type="email"
                name="contactEmail"
                defaultValue={s.contactEmail ?? ""}
                className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
            >
              Save
            </button>
            <span className="text-xs text-neutral-500">
              Re-geocode after address changes is automatic when location is null.
            </span>
          </div>
        </form>
      </section>

      {/* ─── Data sources ───────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Data sources ({dataSources.length})
        </h2>
        {dataSources.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            No data sources yet. Manual re-extract below to create one.
          </p>
        ) : (
          <ul className="space-y-2">
            {dataSources.map((ds) => (
              <li
                key={ds.id}
                className="rounded-xl border border-neutral-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/data-source/${ds.id}`}
                      className="font-mono text-sm text-amber-800 underline-offset-2 hover:underline"
                    >
                      ds {ds.id} · {ds.kind}
                    </Link>
                    <div className="mt-0.5 truncate text-xs text-neutral-600">
                      {ds.identifier}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-xs">
                    <span className={`rounded px-1.5 py-0.5 ${reviewBadge(ds.reviewStatus)}`}>
                      {ds.reviewStatus}
                    </span>
                    {ds.confidenceScore != null && (
                      <span className="text-neutral-500 tabular-nums">
                        conf {ds.confidenceScore.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <Link
                    href={`/admin/data-source/${ds.id}`}
                    className="rounded bg-amber-800 px-2.5 py-1 font-medium text-white hover:bg-amber-900"
                  >
                    Review rules
                  </Link>
                  <form
                    method="post"
                    action={`/api/admin/data-source/${ds.id}/rebuild`}
                    className="inline"
                  >
                    <button
                      type="submit"
                      className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100"
                    >
                      Re-extract from source
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* New extraction from a different URL */}
        {s.submittedUrl && dataSources.length > 0 && (
          <p className="mt-3 text-xs text-neutral-500">
            Need a fresh extraction? Click <strong>Re-extract from source</strong>{" "}
            on any data source above.
          </p>
        )}
      </section>

      {/* ─── Recent scrape runs ─────────────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Recent scrape runs ({runs.length})
        </h2>
        {runs.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            No scrape runs recorded.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white text-xs">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Added</th>
                  <th className="px-3 py-2 text-right">Removed</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-1.5 tabular-nums text-neutral-700">
                      {new Date(r.startedAt).toLocaleString([], {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 ${runBadge(r.status)}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.rulesAdded}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.rulesRemoved}
                    </td>
                    <td className="px-3 py-1.5 text-rose-700 max-w-[16rem] truncate">
                      {r.error ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Danger zone ─────────────────────────────────────── */}
      <section className="mt-8 border-t border-neutral-200 pt-5">
        <h2 className="text-sm font-medium text-neutral-700">Danger zone</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Archive the shul to hide it from the public feed. Rules + data sources
          stay intact and can be reactivated by setting status back to active.
        </p>
        <form
          method="post"
          action={`/api/admin/shul/${s.id}/archive`}
          className="mt-2"
        >
          <button
            type="submit"
            className="rounded border border-rose-300 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
          >
            {s.status === "archived" ? "Reactivate (set status=active)" : "Archive shul"}
          </button>
        </form>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    pending_review: "bg-amber-100 text-amber-800",
    broken: "bg-rose-100 text-rose-800",
    archived: "bg-neutral-100 text-neutral-600",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${styles[status] ?? "bg-neutral-100 text-neutral-700"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function reviewBadge(s: string): string {
  if (s === "approved") return "bg-emerald-100 text-emerald-800";
  if (s === "rejected") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800";
}

function runBadge(s: string): string {
  if (s === "ok") return "bg-emerald-100 text-emerald-800";
  if (s === "no_change") return "bg-neutral-100 text-neutral-700";
  if (s === "broken") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800";
}
