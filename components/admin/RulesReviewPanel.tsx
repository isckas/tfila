import type { MinyanTime } from "@/db/schema";
import { tefillahLabel, formatTime, daysLabel } from "@/lib/minyan-format";

// The extracted-minyan-rules list + per-rule delete control. ONE source of
// truth, rendered in two places:
//   - server-side on the deep review page (app/admin/data-source/[id]/page.tsx)
//   - client-side inside the inbox expand-in-place panel (ReviewExpander)
// It has no server-only imports (only pure format helpers + a type), so it is
// safe in either tree. Writes stay native form-posts (progressive enhancement);
// the delete form 303-redirects back via the route's safeRedirect.

/** The serializable subset of a minyan_rule the panel renders. */
export interface ReviewRule {
  id: number;
  tefillah: string;
  tefillahLabel: string | null;
  specialScheduleKind: string | null;
  nusach: string | null;
  time: MinyanTime;
  daysOfWeek: number[] | null;
  validFrom: string | null;
  validTo: string | null;
  notes: string | null;
  sourceQuote: string | null;
}

/** Narrow a DB minyan_rule row (whose `time` jsonb is loosely typed) to the
 *  panel's ReviewRule. Shared by the deep review page (server) and the
 *  /rules read endpoint (client fetch) so both serialize identically. */
export function toReviewRule(r: {
  id: number;
  tefillah: string;
  tefillahLabel: string | null;
  specialScheduleKind: string | null;
  nusach: string | null;
  time: unknown;
  daysOfWeek: number[] | null;
  validFrom: string | null;
  validTo: string | null;
  notes: string | null;
  sourceQuote: string | null;
}): ReviewRule {
  return {
    id: r.id,
    tefillah: r.tefillah,
    tefillahLabel: r.tefillahLabel,
    specialScheduleKind: r.specialScheduleKind,
    nusach: r.nusach,
    time: r.time as MinyanTime,
    daysOfWeek: r.daysOfWeek,
    validFrom: r.validFrom,
    validTo: r.validTo,
    notes: r.notes,
    sourceQuote: r.sourceQuote,
  };
}

export function RulesReviewPanel({
  rules,
  dsId,
}: {
  rules: ReviewRule[];
  dsId: number;
}) {
  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
        No rules. Either the LLM found nothing or you&apos;ve deleted them all.
      </div>
    );
  }
  return (
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
              {r.specialScheduleKind && r.specialScheduleKind !== "regular" && (
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
              <div className="mt-1 text-xs text-neutral-500">{r.notes}</div>
            )}
            {/* UI-6: source quote shown by default — the whole point of
                grounding is verifying each rule against its quote without
                opening the URL. A rule with no quote is flagged. */}
            {r.sourceQuote ? (
              <blockquote className="mt-1.5 border-l-2 border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-[11px] text-neutral-600">
                {r.sourceQuote}
              </blockquote>
            ) : (
              <div className="mt-1.5 text-[11px] text-amber-800">
                ⚠ no source quote — unverified extraction
              </div>
            )}
          </div>

          <form
            method="post"
            action={`/api/admin/rule/${r.id}/delete?dsId=${dsId}`}
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
  );
}
