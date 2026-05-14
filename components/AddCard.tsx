const INBOUND_ADDRESS = "submit@tfila.co";

/**
 * "Add a shul" card on the home landing. Two paths:
 *   1. URL submission — paste the URL of the shul's schedule page.
 *      POSTs straight to /api/submit; no client JS.
 *   2. Mailing-list subscription — add submit@tfila.co to the shul's
 *      weekly newsletter list. One-time setup; bulletins flow in
 *      automatically. Replaces the older "forward your weekly email"
 *      framing (asking daveners to forward every week was too much).
 *
 * Server component — there's no interactive state.
 */
export function AddCard() {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden className="text-2xl">
          ➕
        </span>
        <h2 className="text-lg font-semibold text-neutral-900">Add a shul</h2>
      </div>
      <p className="mb-3 text-sm text-neutral-600">
        Zero effort for gabbais — pick whichever is easier.
      </p>

      {/* URL submission — straight to /api/submit */}
      <label className="text-xs font-medium text-neutral-700">
        Schedule page URL
      </label>
      <form method="post" action="/api/submit" className="mt-1 flex gap-1.5">
        <input
          type="url"
          name="url"
          required
          placeholder="https://your-shul.org/schedule"
          className="w-full rounded border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded bg-amber-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-900"
        >
          Submit
        </button>
      </form>
      <p className="mt-1.5 text-xs text-neutral-500">
        The page where the calendar / minyan times live — not the
        homepage. We&apos;ll find it if you paste the homepage, but
        the schedule-page URL works better.
      </p>

      <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-wide text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200" />
        or get the weekly email
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
        <div className="text-[10px] uppercase tracking-wide text-amber-900">
          Add this address to your shul&apos;s mailing list
        </div>
        <div className="mt-0.5 select-all font-mono text-sm font-semibold text-amber-950">
          {INBOUND_ADDRESS}
        </div>
      </div>

      <p className="mt-3 text-xs text-neutral-500">
        One-time setup. Every weekly bulletin reaches us automatically;
        we update the times and skip duplicates.
      </p>
    </div>
  );
}
