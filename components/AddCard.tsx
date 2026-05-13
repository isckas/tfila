import Link from "next/link";

const INBOUND_ADDRESS = "submit@tfila.co";

/**
 * "Add a shul" card on the home landing. Embeds both submission
 * paths — a URL input + Submit button (POSTs straight to /api/submit
 * via a plain HTML form, no client JS), and the email-forward
 * address shown inline. /submit is reserved for the optional
 * auto-forward setup walkthrough.
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
      <form method="post" action="/api/submit" className="flex gap-1.5">
        <input
          type="url"
          name="url"
          required
          placeholder="https://your-shul.org"
          className="w-full rounded border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded bg-amber-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-900"
        >
          Submit
        </button>
      </form>

      <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-wide text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200" />
        or forward an email
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
        <div className="text-[10px] uppercase tracking-wide text-amber-900">
          Forward your shul&apos;s weekly bulletin to
        </div>
        <div className="mt-0.5 select-all font-mono text-sm font-semibold text-amber-950">
          {INBOUND_ADDRESS}
        </div>
      </div>

      <p className="mt-3 text-xs text-neutral-500">
        Forward once and we&apos;ll learn your shul. Forward again next week
        and we&apos;ll update — no duplicates.
      </p>

      <Link
        href="/submit"
        className="mt-auto pt-3 text-xs text-amber-800 underline-offset-2 hover:underline"
      >
        Set up auto-forward (one-time, 2 min) →
      </Link>
    </div>
  );
}
