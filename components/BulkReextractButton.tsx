"use client";

/**
 * Confirm-gated "re-extract all broken" admin action (UI-5 stretch). Fires LLM
 * extractions, so it asks first. Safe at the system level — the global
 * concurrency cap throttles to 3-at-a-time (no 429 storm) and the daily
 * cost-gate caps spend — but a confirm keeps an accidental click from kicking
 * off a fleet-wide re-extract.
 */
export function BulkReextractButton({ count }: { count: number }) {
  return (
    <form
      method="post"
      action="/api/admin/bulk-reextract"
      className="inline"
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Re-extract all ${count} broken shul${count === 1 ? "" : "s"} now?\n\n` +
              "This fires LLM extractions (throttled to 3 at a time, capped by the daily budget). OK to proceed?",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-lg bg-amber-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-900"
      >
        Re-extract all {count} broken
      </button>
    </form>
  );
}
