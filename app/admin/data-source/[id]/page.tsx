import Link from "next/link";
import { notFound } from "next/navigation";
import { getDataSourceForReview } from "@/lib/queries";
import type { MinyanTime } from "@/db/schema";
import { parseCascadeAttempts } from "@/lib/llm/cascade";

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
  const extractionStrategy =
    (ds as { extractionStrategy?: string | null }).extractionStrategy ?? null;

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
          {extractionStrategy && (
            <span
              className={`rounded px-2 py-0.5 ${
                extractionStrategy === "failed"
                  ? "bg-rose-100 text-rose-800"
                  : extractionStrategy === "html"
                    ? "bg-neutral-100 text-neutral-700"
                    : "bg-amber-100 text-amber-900"
              }`}
              title={
                extractionStrategy === "html"
                  ? "Extracted from raw HTML"
                  : extractionStrategy === "js_rendered"
                    ? "Extracted from JavaScript-rendered HTML (Browserless)"
                    : extractionStrategy === "pdf_document"
                      ? "Extracted from a PDF document via Claude"
                      : extractionStrategy === "vision_image"
                        ? "Extracted from a schedule image via Claude vision"
                        : extractionStrategy === "failed"
                          ? "Cascade exhausted — no rules extracted from any tier"
                          : ""
              }
            >
              strategy: <span className="font-medium">{extractionStrategy.replace(/_/g, " ")}</span>
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
        {ds.reviewStatus === "rejected" ? (
          <form
            method="post"
            action={`/api/admin/data-source/${ds.id}/unreject`}
            className="inline"
          >
            <button
              type="submit"
              className="rounded border border-amber-400 bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Move back to pending
            </button>
          </form>
        ) : (
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
        )}
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

      {/* Cascade attempt breakdown (always shown when present) */}
      {(() => {
        const attempts = parseCascadeAttempts(config.cascade_attempts);
        if (attempts.length === 0) return null;
        return (
          <section className="mt-5">
            <h2 className="mb-1 text-sm font-medium text-neutral-700">
              Cascade attempts
            </h2>
            <ol className="space-y-2">
              {attempts.map((a, i) => {
                const strategy = a.strategy;
                const status = a.status;
                const rules = a.rulesCount;
                const conf = a.confidence;
                const url = a.resourceUrl ?? null;
                const err = a.errorMessage ?? null;
                const isWinner = strategy === extractionStrategy;
                const badge =
                  status === "extracted" && isWinner
                    ? "bg-emerald-200 text-emerald-900"
                    : status === "extracted"
                      ? "bg-amber-200 text-amber-900"
                      : status === "skipped"
                        ? "bg-neutral-200 text-neutral-700"
                        : "bg-rose-200 text-rose-900";
                return (
                  <li
                    key={i}
                    className={`rounded-xl border p-3 text-sm ${
                      isWinner
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-neutral-200 bg-white"
                    }`}
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
                      {isWinner && (
                        <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-emerald-900">
                          winner
                        </span>
                      )}
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
                      <div className="mt-1 break-words text-[11px] text-rose-700">
                        {err}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })()}

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
                      <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">
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
                  {r.sourceQuote && (
                    <details className="mt-1.5 text-xs">
                      <summary className="cursor-pointer text-neutral-400 hover:text-neutral-700">
                        source
                      </summary>
                      <blockquote className="mt-1 border-l-2 border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-[11px] text-neutral-700">
                        {r.sourceQuote}
                      </blockquote>
                    </details>
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
