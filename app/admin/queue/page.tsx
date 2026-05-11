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
        Newly-built scrape configs awaiting review. Sorted by confidence ascending — lowest first.
      </p>

      <section className="mb-8 flex flex-wrap gap-3 text-sm">
        {statusCounts.map((c) => (
          <span
            key={c.status}
            className="rounded border border-neutral-200 bg-neutral-50 px-3 py-1"
          >
            <span className="font-medium">{c.n}</span> {c.status.replace("_", " ")}
          </span>
        ))}
      </section>

      <section>
        {pending.length === 0 ? (
          <div className="rounded border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
            Nothing pending review. Submissions land here once the LLM schema-builder runs.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-600">
                <th className="py-2 pr-4">Confidence</th>
                <th className="py-2 pr-4">Shul</th>
                <th className="py-2 pr-4">Kind</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4">Built</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((d) => (
                <tr key={d.id} className="border-b border-neutral-100">
                  <td className="py-2 pr-4 tabular-nums">
                    {d.confidenceScore != null ? d.confidenceScore.toFixed(2) : "—"}
                  </td>
                  <td className="py-2 pr-4">{d.shulName}</td>
                  <td className="py-2 pr-4 text-neutral-600">{d.kind}</td>
                  <td className="py-2 pr-4 truncate max-w-xs">
                    <a
                      href={d.identifier}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neutral-700 underline-offset-2 hover:underline"
                    >
                      {d.identifier}
                    </a>
                  </td>
                  <td className="py-2 pr-4 text-neutral-600">
                    {d.builtAt ? new Date(d.builtAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-4 text-xs text-neutral-500">
          Approve / reject actions will land in PR 6.
        </p>
      </section>
    </div>
  );
}
