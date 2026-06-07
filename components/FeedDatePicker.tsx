"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Feed date picker (UI-2). Navigates on `change` — no separate "Update"
 * button to tap. The 90%-case is "today", so the input defaults to today and
 * only travelers who pick another date trigger a navigation. STYLE.md: live
 * feedback beats a submit roundtrip.
 */
export function FeedDatePicker({
  lat,
  lng,
  radius,
  via,
  value,
  isTravelMode,
}: {
  lat: number;
  lng: number;
  radius?: string;
  via?: string;
  value: string;
  isTravelMode: boolean;
}) {
  const router = useRouter();
  const base = `/?lat=${lat}&lng=${lng}${radius ? `&radius=${radius}` : ""}${
    via ? `&via=${via}` : ""
  }`;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
      <label className="flex items-center gap-1.5">
        <span className="text-neutral-500">Date:</span>
        <input
          type="date"
          defaultValue={value}
          onChange={(e) => {
            const d = e.target.value;
            if (d) router.push(`${base}&date=${d}`);
          }}
          className="min-h-9 rounded border border-neutral-300 bg-white px-2 py-1 text-xs focus-visible:border-neutral-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-300"
        />
      </label>
      {isTravelMode && (
        <Link
          href={base}
          className="text-xs text-neutral-500 underline-offset-2 hover:underline"
        >
          back to today
        </Link>
      )}
    </div>
  );
}
