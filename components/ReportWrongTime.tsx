"use client";

import { useState } from "react";

/**
 * E-B5 — "Report a wrong time" tap on the shul detail page.
 *
 * The cheapest accuracy signal we have: a daven-er who's physically at the
 * shul notices a wrong time and tells us. Form-on-card per STYLE.md (expands
 * in place, no navigation, no redirect). Anonymous — posts to
 * /api/report-time, which records a lightweight report for admin triage.
 */
export function ReportWrongTime({ shulId }: { shulId: number }) {
  const [state, setState] = useState<
    "idle" | "open" | "sending" | "done" | "error"
  >("idle");
  const [note, setNote] = useState("");

  if (state === "done") {
    return (
      <p className="mt-3 text-xs text-emerald-700">
        Thanks — we&apos;ll re-check this shul&apos;s times.
      </p>
    );
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => setState("open")}
        className="mt-3 text-xs text-neutral-500 underline-offset-2 hover:underline"
      >
        Report a wrong time
      </button>
    );
  }

  async function submit() {
    setState("sending");
    try {
      const res = await fetch("/api/report-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shulId, note: note.trim() || undefined }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
      <label
        htmlFor="report-note"
        className="block text-xs font-medium text-neutral-700"
      >
        Something off? Tell us what to re-check.
      </label>
      <textarea
        id="report-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="e.g. Mincha is 7:15, not 7:00"
        className="mt-1.5 w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm focus-visible:border-neutral-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-300"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={state === "sending"}
          className="rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-900 disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : "Send report"}
        </button>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="text-xs text-neutral-500 underline-offset-2 hover:underline"
        >
          Cancel
        </button>
        {state === "error" && (
          <span className="text-xs text-rose-600">
            Couldn&apos;t send — try again.
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        A note is optional. We&apos;ll re-verify against the shul&apos;s source.
      </p>
    </div>
  );
}
