import Link from "next/link";
import { listOpenTimeReports } from "@/lib/queries";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * E-B5 — admin triage for user "this time looks wrong" reports.
 *
 * Minimal interim surface (the full cockpit integration is folded into the
 * P4 redesign). Lists open reports newest-first; each links through to the
 * shul's admin page (where "Extract Now" lives) and offers Resolve / Dismiss.
 */
export default async function AdminReportsPage() {
  await requireAdmin();
  const reports = await listOpenTimeReports(200);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/admin" className="text-xs text-neutral-500 hover:underline">
        ← admin
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Wrong-time reports</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {reports.length} open report{reports.length === 1 ? "" : "s"} from
        daveners. Re-extract the shul to fix, then mark resolved — or dismiss if
        the time was actually correct.
      </p>

      {reports.length === 0 ? (
        <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
          ✓ No open reports.
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {reports.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-neutral-200 bg-white px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/admin/shul/${r.shulSlug}`}
                  className="font-medium text-neutral-900 underline-offset-2 hover:underline"
                >
                  {r.shulName}
                </Link>
                <span className="text-xs text-neutral-500">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {r.note ? (
                <p className="mt-1 text-sm text-neutral-700">“{r.note}”</p>
              ) : (
                <p className="mt-1 text-sm italic text-neutral-400">
                  (no note — general report)
                </p>
              )}
              <div className="mt-2 flex items-center gap-3 text-xs">
                <Link
                  href={`/shul/${r.shulSlug}`}
                  target="_blank"
                  className="text-neutral-500 underline-offset-2 hover:underline"
                >
                  view public page →
                </Link>
                <form
                  method="post"
                  action={`/api/admin/report/${r.id}/resolve`}
                  className="ml-auto inline"
                >
                  <input type="hidden" name="status" value="resolved" />
                  <button
                    type="submit"
                    className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-800 hover:bg-emerald-100"
                  >
                    Mark resolved
                  </button>
                </form>
                <form
                  method="post"
                  action={`/api/admin/report/${r.id}/resolve`}
                  className="inline"
                >
                  <input type="hidden" name="status" value="dismissed" />
                  <button
                    type="submit"
                    className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 hover:bg-neutral-100"
                  >
                    Dismiss
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
