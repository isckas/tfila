"use client";

import { useRouter, useSearchParams } from "next/navigation";

const RADIUS_OPTIONS = [0.5, 1, 2, 5, 10, 25];

interface Props {
  current: number;
}

/**
 * Compact radius selector for the feed header. Updates the URL on
 * change so the server re-runs the radius-filtered query.
 */
export function RadiusSelector({ current }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <label className="flex items-center gap-1 text-xs text-neutral-700">
      <span>within</span>
      <select
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("radius", e.target.value);
          router.replace(`/?${next.toString()}`);
        }}
        className="min-h-9 rounded border border-neutral-300 bg-white px-2 py-1 text-xs focus-visible:border-neutral-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-300"
      >
        {RADIUS_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r} mi
          </option>
        ))}
      </select>
    </label>
  );
}
