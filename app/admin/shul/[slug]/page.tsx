import Link from "next/link";
import { notFound } from "next/navigation";
import { getShulForAdmin, getRecentScrapeRunsForShul } from "@/lib/queries";
import { parseCascadeAttempts } from "@/lib/llm/cascade";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    extracted?: string;
    err?: string;
    rebuilt?: string;
    from?: string;
    strategy?: string;
    resource?: string;
    address?: string;
  }>;
}

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending_review: "Pending review",
  active: "Active",
  broken: "Broken",
  archived: "Archived",
  unsupported: "Unsupported",
};

export default async function AdminShulDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
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

      {/* Status banner from a recent action */}
      {sp.extracted === "1" && (
        <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          ✓ Extraction complete{sp.strategy ? ` via ${sp.strategy.replace(/_/g, " ")}` : ""}.
          Review the new data source below.
          {sp.from && (
            <div className="mt-1 text-xs text-emerald-800">
              The submitted URL had no times; used a fallback URL on the same
              origin instead:{" "}
              <code className="rounded bg-emerald-100 px-1.5 py-0.5">
                {sp.from}
              </code>
              . Consider updating the source URL to match.
            </div>
          )}
          {sp.resource && (
            <div className="mt-1 text-xs text-emerald-800">
              Extracted this week&apos;s schedule from{" "}
              <code className="rounded bg-emerald-100 px-1.5 py-0.5 break-all">
                {sp.resource}
              </code>
              . The data source identifier stays on the page URL, so weekly
              rescrapes will re-discover next week&apos;s resource automatically.
            </div>
          )}
          {sp.address === "places" && (
            <div className="mt-1 text-xs text-emerald-800">
              📍 Address backfilled from Google Places (shul name + URL hint).
              Verify on the public page; edit below if it&apos;s wrong.
            </div>
          )}
        </div>
      )}
      {sp.rebuilt === "1" && (
        <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          ✓ Re-extraction queued. A new data source will appear here once the
          LLM finishes (~30 seconds; check back).
        </div>
      )}
      {sp.err && (
        <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {decodeURIComponent(sp.err)}
        </div>
      )}

      {/* Verbose cascade-attempt breakdown when the latest extraction failed */}
      {(() => {
        const latestFailed = dataSources.find(
          (ds) => ds.extractionStrategy === "failed",
        );
        if (!latestFailed) return null;
        const cfg = (latestFailed.configJson as Record<string, unknown>) ?? {};
        const attempts = parseCascadeAttempts(cfg.cascade_attempts);
        return (
          <section className="mt-4 rounded-xl border-2 border-rose-300 bg-rose-50 p-4 text-sm">
            <header className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="font-semibold text-rose-900">
                Extraction failed across all tiers
              </h3>
              <span className="text-xs text-rose-700">
                data_source #{latestFailed.id}
              </span>
            </header>
            <p className="mb-3 text-xs text-rose-800">
              Shul marked <code className="rounded bg-rose-100 px-1 py-0.5">unsupported</code>{" "}
              so the weekly cron won&apos;t re-attempt. Edit the source URL
              and click <strong>Extract now</strong> to try again.
            </p>
            {attempts.length === 0 ? (
              <p className="text-xs text-rose-800">
                (No cascade_attempts recorded — legacy data_source row.)
              </p>
            ) : (
              <ol className="space-y-2">
                {attempts.map((a, i) => {
                  const strategy = a.strategy;
                  const status = a.status;
                  const rules = a.rulesCount;
                  const conf = a.confidence;
                  const url = a.resourceUrl ?? null;
                  const err = a.errorMessage ?? null;
                  const badge =
                    status === "extracted"
                      ? "bg-amber-200 text-amber-900"
                      : status === "skipped"
                        ? "bg-neutral-200 text-neutral-700"
                        : "bg-rose-200 text-rose-900";
                  return (
                    <li
                      key={i}
                      className="rounded border border-rose-200 bg-white p-2.5"
                    >
                      <div className="flex flex-wrap items-baseline gap-2 text-xs">
                        <span className="font-semibold text-neutral-700">
                          [{i + 1}]
                        </span>
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-800">
                          {strategy.replace(/_/g, " ")}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 ${badge}`}>
                          {status.replace(/_/g, " ")}
                        </span>
                        <span className="text-neutral-600 tabular-nums">
                          rules: {rules}
                        </span>
                        {conf != null && (
                          <span className="text-neutral-600 tabular-nums">
                            conf: {conf.toFixed(2)}
                          </span>
                        )}
                      </div>
                      {url && (
                        <div className="mt-1 truncate font-mono text-[11px] text-neutral-500">
                          {url}
                        </div>
                      )}
                      {err && (
                        <div className="mt-1 break-words text-[11px] text-rose-800">
                          {err}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })()}

      {/* No-data-source warning (still shown when relevant) */}
      {dataSources.length === 0 && s.submittedUrl && (
        <section className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>No data source yet</strong> — automatic extraction
          hasn&apos;t run for this shul. Hit{" "}
          <span className="font-medium">Extract now</span> in the Source URL
          section below.
        </section>
      )}

      {/* ─── Source URL (editable + extract trigger) ───────── */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">Source URL</h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <form method="post" action={`/api/admin/shul/${s.id}/edit`}>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Calendar / schedule URL
              </span>
              <input
                type="url"
                name="submittedUrl"
                defaultValue={s.submittedUrl ?? ""}
                placeholder="https://example-shul.org/calendar"
                className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm font-mono focus:border-neutral-500 focus:outline-none"
              />
            </label>
            {/* Re-submit the rest of the existing values so the edit endpoint
                doesn't blow them away */}
            <input type="hidden" name="name" value={s.name} />
            <input type="hidden" name="timezone" value={s.timezone ?? ""} />
            <input type="hidden" name="address" value={s.address ?? ""} />
            <input type="hidden" name="nusach" value={s.nusach ?? ""} />
            <input
              type="hidden"
              name="contactEmail"
              value={s.contactEmail ?? ""}
            />
            <p className="mt-1 text-xs text-neutral-500">
              The page we scrape minyan times from. If the originally submitted
              URL was wrong, paste the correct one (often a /calendar or
              /schedule path) and Save.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
              >
                Save URL
              </button>
            </div>
          </form>
          {s.submittedUrl && (
            <form
              method="post"
              action={`/api/admin/shul/${s.id}/extract`}
              className="mt-3 border-t border-neutral-200 pt-3"
            >
              <button
                type="submit"
                className="rounded bg-amber-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-900"
              >
                Extract now from this URL
              </button>
              <span className="ml-2 text-xs text-neutral-500">
                ~30 seconds. Creates a new pending data source — old ones
                remain so you can compare and reject.
              </span>
            </form>
          )}
        </div>
      </section>

      {/* ─── Edit shul metadata ──────────────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Metadata (location / nusach)
        </h2>
        <form
          method="post"
          action={`/api/admin/shul/${s.id}/edit`}
          className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4"
        >
          {/* Preserve the source URL when this form is submitted */}
          <input
            type="hidden"
            name="submittedUrl"
            value={s.submittedUrl ?? ""}
          />
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
              Save metadata
            </button>
            <span className="text-xs text-neutral-500">
              Times come from the extractor — not editable here.
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
                    {ds.extractionStrategy && (
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          ds.extractionStrategy === "failed"
                            ? "bg-rose-100 text-rose-800"
                            : ds.extractionStrategy === "html"
                              ? "bg-neutral-100 text-neutral-700"
                              : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {ds.extractionStrategy.replace(/_/g, " ")}
                      </span>
                    )}
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
    unsupported: "bg-rose-100 text-rose-900",
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
