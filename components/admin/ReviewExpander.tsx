"use client";

import { useState } from "react";
import Link from "next/link";
import { RulesReviewPanel, type ReviewRule } from "@/components/admin/RulesReviewPanel";

interface RulesPayload {
  ds: {
    id: number;
    kind: string;
    identifier: string;
    reviewStatus: string;
    confidenceScore: number | null;
  };
  shul: { name: string | null; slug: string | null };
  reasoning: string | null;
  rules: ReviewRule[];
}

/**
 * Expand-in-place rule review for an inbox row. Lazy-fetches the extraction's
 * rules from GET /api/admin/data-source/[id]/rules on first open, renders the
 * shared RulesReviewPanel inline, and offers Approve / Reject right there — no
 * hop to the deep /admin/data-source/[id] page.
 *
 * Reads are client fetches; WRITES stay native form-posts. Approve / Reject
 * 303-redirect back to /admin (safeRedirect honors the inbox Referer), so the
 * row reflects the new state on reload (an approved row leaves the inbox). The
 * per-rule Delete instead lands on the deep /admin/data-source/[id] page (the
 * delete route prefers the explicit ?dsId over the Referer) — the full review
 * surface to keep deleting wrong rules in context. Either way the server stays
 * the single source of truth — no optimistic client re-derivation of state.
 *
 * Fetch failure degrades to a link to the full page.
 */
export function ReviewExpander({
  dataSourceId,
  label = "Review extraction",
}: {
  dataSourceId: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RulesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(
          `/api/admin/data-source/${dataSourceId}/rules`,
          { headers: { accept: "application/json" } },
        );
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as RulesPayload);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-900"
      >
        {open ? "Hide rules ▴" : `${label} ▾`}
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          {loading && (
            <p className="text-xs text-neutral-500">Loading extraction…</p>
          )}
          {error && (
            <p className="text-xs text-rose-700">
              Couldn&apos;t load the rules.{" "}
              <Link
                href={`/admin/data-source/${dataSourceId}`}
                className="underline underline-offset-2"
              >
                Open the full page →
              </Link>
            </p>
          )}
          {data && (
            <>
              {data.reasoning && (
                <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-neutral-800">
                  <span className="font-medium">What the LLM saw: </span>
                  {data.reasoning}
                </div>
              )}
              <p className="mb-2 text-[11px] text-neutral-500">
                {data.ds.confidenceScore != null && (
                  <>
                    confidence{" "}
                    <span className="font-medium tabular-nums">
                      {data.ds.confidenceScore.toFixed(2)}
                    </span>{" "}
                    ·{" "}
                  </>
                )}
                {data.rules.length} rule{data.rules.length === 1 ? "" : "s"} —
                delete any that look wrong, then approve.
              </p>
              <RulesReviewPanel rules={data.rules} dsId={data.ds.id} />

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3">
                <form
                  method="post"
                  action={`/api/admin/data-source/${data.ds.id}/approve`}
                >
                  <button
                    type="submit"
                    className="rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
                  >
                    Approve — go live
                  </button>
                </form>
                <form
                  method="post"
                  action={`/api/admin/data-source/${data.ds.id}/reject`}
                >
                  <button
                    type="submit"
                    className="rounded border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                  >
                    Reject
                  </button>
                </form>
                <Link
                  href={`/admin/data-source/${data.ds.id}`}
                  className="ml-auto text-xs text-neutral-500 underline-offset-2 hover:underline"
                >
                  full page →
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
