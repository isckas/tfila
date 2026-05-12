import Link from "next/link";
import { listPendingDataSources, countByShulStatus } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage() {
  const [pending, statusCounts] = await Promise.all([
    listPendingDataSources(),
    countByShulStatus(),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold mb-1">Review queue</h1>
      <p className="text-sm text-neutral-600 mb-6">
        Newly-built scrape configs awaiting review. Sorted by confidence
        ascending — lowest first.
      </p>

      <section className="mb-6 flex flex-wrap gap-3 text-sm">
        {statusCounts.map((c) => (
          <span
            key={c.status}
            className="rounded border border-neutral-200 bg-neutral-50 px-3 py-1"
          >
            <span className="font-medium">{c.n}</span>{" "}
            {c.status.replace("_", " ")}
          </span>
        ))}
      </section>

      <section>
        {pending.length === 0 ? (
          <div className="rounded border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
            Nothing pending review.
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((d) => (
              <li
                key={d.id}
                className="rounded-xl border border-neutral-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/data-source/${d.id}`}
                      className="font-medium text-neutral-900 hover:text-amber-800 hover:underline underline-offset-2"
                    >
                      {d.shulName}
                    </Link>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      <span className="font-mono">{d.kind}</span>
                      {" · "}
                      {d.kind === "email_newsletter" ? (
                        <a
                          href={`mailto:${d.identifier}`}
                          className="underline-offset-2 hover:underline break-all"
                        >
                          {d.identifier}
                        </a>
                      ) : (
                        <a
                          href={d.identifier}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-2 hover:underline break-all"
                        >
                          {d.identifier}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs uppercase tracking-wide text-neutral-500">
                      Confidence
                    </div>
                    <div className="text-lg font-semibold tabular-nums">
                      {d.confidenceScore != null
                        ? d.confidenceScore.toFixed(2)
                        : "—"}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/data-source/${d.id}`}
                    className="rounded bg-amber-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-900"
                  >
                    Review rules →
                  </Link>
                  <form
                    method="post"
                    action={`/api/admin/data-source/${d.id}/approve`}
                    className="inline"
                  >
                    <button
                      type="submit"
                      className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                    >
                      Approve
                    </button>
                  </form>
                  <form
                    method="post"
                    action={`/api/admin/data-source/${d.id}/reject`}
                    className="inline"
                  >
                    <button
                      type="submit"
                      className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                    >
                      Reject
                    </button>
                  </form>
                  <span className="ml-2 text-xs text-neutral-500">
                    Built{" "}
                    {d.builtAt
                      ? new Date(d.builtAt).toLocaleString([], {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "—"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
