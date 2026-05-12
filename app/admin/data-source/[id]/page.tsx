import Link from "next/link";
import { notFound } from "next/navigation";
import { getDataSourceForReview } from "@/lib/queries";
import type { MinyanTime } from "@/db/schema";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function ReviewDetailPage({ params }: PageProps) {
  const { id } = await params;
  const dsId = Number(id);
  if (!Number.isInteger(dsId)) notFound();

  const payload = await getDataSourceForReview(dsId);
  if (!payload) notFound();

  const { dataSource: ds, shul: s, rules } = payload;
  const config = (ds.configJson as Record<string, unknown> | null) ?? {};
  const reasoning = typeof config.reasoning === "string" ? config.reasoning : null;
  const model = typeof config.model === "string" ? config.model : null;
  const extractedAt =
    typeof config.extracted_at === "string" ? config.extracted_at : null;
  const pageUrl =
    typeof config.page_url === "string" ? config.page_url : ds.identifier;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <Link
        href="/admin/queue"
        className="text-xs text-neutral-500 hover:underline"
      >
        ← back to queue
      </Link>

      {/* Header */}
      <header className="mt-3">
        <h1 className="text-2xl font-semibold text-neutral-900">
          {s?.name ?? "(unknown shul)"}
        </h1>
        {s?.address && (
          <p className="text-sm text-neutral-600">{s.address}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono">
            {ds.kind}
          </span>
          <span className="rounded bg-neutral-100 px-2 py-0.5">
            review: <span className="font-medium">{ds.reviewStatus}</span>
          </span>
          {ds.confidenceScore != null && (
            <span className="rounded bg-neutral-100 px-2 py-0.5">
              confidence:{" "}
              <span className="font-medium tabular-nums">
                {ds.confidenceScore.toFixed(2)}
              </span>
            </span>
          )}
          {extractedAt && (
            <span className="rounded bg-neutral-100 px-2 py-0.5">
              extracted{" "}
              {new Date(extractedAt).toLocaleString([], {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </span>
          )}
          {model && (
            <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono">
              {model}
            </span>
          )}
        </div>

        <p className="mt-3 text-xs">
          {ds.kind === "email_newsletter" ? (
            <>
              Source:{" "}
              <a
                href={`mailto:${ds.identifier}`}
                className="text-amber-800 underline-offset-2 hover:underline"
              >
                {ds.identifier}
              </a>
            </>
          ) : (
            <>
              Source:{" "}
              <a
                href={pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-800 underline-offset-2 hover:underline break-all"
              >
                {pageUrl}
              </a>
            </>
          )}
        </p>
      </header>

      {/* Approve / Reject — sticky-ish at top */}
      <section className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3">
        <form
          method="post"
          action={`/api/admin/data-source/${ds.id}/approve`}
          className="inline"
        >
          <button
            type="submit"
            className="rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Approve
          </button>
        </form>
        <form
          method="post"
          action={`/api/admin/data-source/${ds.id}/reject`}
          className="inline"
        >
          <button
            type="submit"
            className="rounded border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Reject
          </button>
        </form>
        <span className="ml-2 text-xs text-neutral-500">
          {rules.length} rule{rules.length === 1 ? "" : "s"} below. Delete any
          that look wrong, then approve.
        </span>
      </section>

      <p className="mt-2 text-xs text-neutral-500">
        Times come from the automated extractor — admin can delete a rule but
        not hand-edit times. If a rule has the wrong time, delete it and
        re-extract the data source so the LLM produces a fresh one.
      </p>

      {/* LLM reasoning */}
      {reasoning && (
        <section className="mt-5">
          <h2 className="mb-1 text-sm font-medium text-neutral-700">
            What the LLM saw
          </h2>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-neutral-800">
            {reasoning}
          </div>
        </section>
      )}

      {/* Rules table */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Extracted minyan rules
        </h2>
        {rules.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
            No rules. Either the LLM found nothing or you&apos;ve deleted them
            all.
          </div>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-neutral-900">
                    {tefillahLabel(r.tefillah)}
                    {r.tefillahLabel && (
                      <span className="ml-2 text-xs text-neutral-500">
                        ({r.tefillahLabel})
                      </span>
                    )}
                    {r.specialScheduleKind &&
                      r.specialScheduleKind !== "regular" && (
                        <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-800">
                          {r.specialScheduleKind.replace(/_/g, " ")}
                        </span>
                      )}
                    {r.nusach && (
                      <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                        {r.nusach}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-700">
                    <span className="font-mono tabular-nums">
                      {formatTime(r.time as MinyanTime)}
                    </span>
                    {" · "}
                    <span>{daysLabel(r.daysOfWeek)}</span>
                    {(r.validFrom || r.validTo) && (
                      <>
                        {" · "}
                        <span className="text-neutral-500">
                          {r.validFrom ?? "−∞"} → {r.validTo ?? "∞"}
                        </span>
                      </>
                    )}
                  </div>
                  {r.notes && (
                    <div className="mt-1 text-xs text-neutral-500">
                      {r.notes}
                    </div>
                  )}
                </div>

                <form
                  method="post"
                  action={`/api/admin/rule/${r.id}/delete?dsId=${ds.id}`}
                  className="shrink-0"
                >
                  <button
                    type="submit"
                    className="rounded border border-rose-300 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Reviewer notes (if previously reviewed) */}
      {ds.reviewerNotes && (
        <section className="mt-6 text-xs text-neutral-500">
          <strong className="text-neutral-700">Reviewer note:</strong>{" "}
          {ds.reviewerNotes}
        </section>
      )}
    </div>
  );
}

const TEFILLAH_LABEL: Record<string, string> = {
  shacharis: "Shacharis",
  mincha: "Mincha",
  maariv: "Maariv",
  selichos: "Selichos",
  neilah: "Neilah",
  other: "Other",
};

function tefillahLabel(t: string): string {
  return TEFILLAH_LABEL[t] ?? t;
}

function formatTime(t: MinyanTime): string {
  if (t.kind === "fixed") {
    const [hStr, mStr] = t.clock.split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return t.clock;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
  }
  const off = t.offsetMin;
  const offDesc =
    off === 0 ? "at" : off > 0 ? `${off} min after` : `${Math.abs(off)} min before`;
  return `${offDesc} ${t.anchor.replace(/_/g, " ")}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Shabbos"];

function daysLabel(days: number[] | null): string {
  if (!days || days.length === 0) return "(no recurring day — check valid_from/to)";
  if (days.length === 7) return "Every day";
  if (
    days.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => days.includes(d))
  )
    return "Mon-Fri";
  if (days.length === 1) return DAY_NAMES[days[0]];
  return days.map((d) => DAY_NAMES[d]).join(", ");
}
