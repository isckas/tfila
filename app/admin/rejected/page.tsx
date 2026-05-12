import Link from "next/link";
import { listRejectedDataSources } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AdminRejectedPage() {
  const rejected = await listRejectedDataSources();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold mb-1">Rejected data sources</h1>
      <p className="text-sm text-neutral-600 mb-6">
        Previously rejected scrape configs. Move one back to{" "}
        <span className="font-medium">pending</span> to re-queue it for review,
        or <span className="font-medium">approve</span> it directly. Sorted by
        most-recently rejected first.
      </p>

      <section>
        {rejected.length === 0 ? (
          <div className="rounded border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
            Nothing rejected.
          </div>
        ) : (
          <ul className="space-y-3">
            {rejected.map((d) => (
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
                    {d.reviewerNotes && (
                      <div className="mt-1 text-xs italic text-neutral-500">
                        {d.reviewerNotes}
                      </div>
                    )}
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
                    action={`/api/admin/data-source/${d.id}/unreject`}
                    className="inline"
                  >
                    <button
                      type="submit"
                      className="rounded border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    >
                      Move back to pending
                    </button>
                  </form>
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
                  <Link
                    href={`/admin/shul/${d.shulSlug}`}
                    className="ml-2 text-xs text-neutral-500 underline-offset-2 hover:underline"
                  >
                    Shul page →
                  </Link>
                  {d.updatedAt && (
                    <span className="ml-2 text-xs text-neutral-500">
                      Rejected{" "}
                      {new Date(d.updatedAt).toLocaleString([], {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
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
