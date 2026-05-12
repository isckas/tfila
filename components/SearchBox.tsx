interface Props {
  /** Compact = small, inline; full = larger with label. */
  variant?: "compact" | "full";
  placeholder?: string;
}

/**
 * Plain HTML form — no client JS. Submits GET to /api/search which
 * geocodes via Google and redirects back to / with lat/lng params.
 */
export function SearchBox({ variant = "full", placeholder }: Props) {
  if (variant === "compact") {
    return (
      <form method="get" action="/api/search" className="flex gap-1">
        <input
          type="search"
          name="q"
          required
          placeholder={placeholder ?? "Search location…"}
          className="w-full rounded border border-neutral-300 px-2.5 py-1 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded bg-neutral-900 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Go
        </button>
      </form>
    );
  }
  return (
    <form method="get" action="/api/search" className="space-y-2">
      <label className="block text-sm font-medium text-neutral-800">
        Search by location
      </label>
      <div className="flex gap-2">
        <input
          type="search"
          name="q"
          required
          placeholder={placeholder ?? "Address, neighborhood, or city"}
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Search
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        e.g. &ldquo;Upper West Side, NYC&rdquo; · &ldquo;Fair Lawn, NJ&rdquo; · zip
        code · full address
      </p>
    </form>
  );
}
