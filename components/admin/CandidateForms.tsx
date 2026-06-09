// Inline approve/reject controls for a pending shul_candidate. Shared by the
// deep discovery page (/admin/candidates) and the mission-control inbox's
// Discovery section, so a candidate can be fully triaged from either place.
//
// Server components — the only interactivity is the native <details> popover,
// so they drop straight into a server-rendered list with no client bundle.

export function ApproveNoUrlForm({ candidateId }: { candidateId: number }) {
  // No green Approve button — tfila.co only publishes shuls with live
  // times, so we don't create rows for candidates without a URL.
  // Admin must either paste a URL (then extraction runs as normal) or
  // reject the candidate.
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100">
        Add URL &amp; approve
      </summary>
      <form
        method="post"
        action={`/api/admin/candidate/${candidateId}/approve`}
        className="absolute right-0 z-10 mt-1 w-72 space-y-3 rounded-xl border border-neutral-300 bg-white p-3 shadow-lg"
      >
        <div>
          <label className="block text-xs font-medium text-neutral-700">
            Shul website URL <span className="text-rose-700">*</span>
          </label>
          <input
            type="url"
            name="urlOverride"
            placeholder="https://example-shul.org"
            required
            className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            Required. Without a URL we can&apos;t extract times, and
            tfila.co only lists shuls with live times. Reject the
            candidate if no website exists.
          </p>
        </div>
        <button
          type="submit"
          className="w-full rounded bg-emerald-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
        >
          Approve with this URL
        </button>
      </form>
    </details>
  );
}

export function RejectForm({ candidateId }: { candidateId: number }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded border border-rose-300 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50">
        Reject
      </summary>
      <form
        method="post"
        action={`/api/admin/candidate/${candidateId}/reject`}
        className="absolute right-0 z-10 mt-1 w-64 rounded-xl border border-neutral-300 bg-white p-3 shadow-lg"
      >
        <label className="block text-xs font-medium text-neutral-700">
          Reason
          <input
            type="text"
            name="reason"
            placeholder="not a shul / chabad house / duplicate of …"
            className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
            required
          />
        </label>
        <button
          type="submit"
          className="mt-2 w-full rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
        >
          Confirm reject
        </button>
      </form>
    </details>
  );
}
