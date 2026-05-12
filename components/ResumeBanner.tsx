"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "tfila.location";

interface SavedLocation {
  lat: number;
  lng: number;
  radius?: number;
  savedAt: number;
}

/**
 * Shows on the no-location landing if the visitor has a previously-
 * saved location. Lets them jump back to their feed with one click,
 * without forcing an auto-redirect. Renders nothing if no saved
 * location.
 */
export function ResumeBanner() {
  const [saved, setSaved] = useState<SavedLocation | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedLocation;
      if (
        typeof parsed.lat !== "number" ||
        typeof parsed.lng !== "number"
      )
        return;
      setSaved(parsed);
    } catch {
      // private mode / parse error — non-fatal
    }
  }, []);

  if (!saved) return null;

  const r = saved.radius ?? 2;
  const href = `/?lat=${saved.lat}&lng=${saved.lng}&radius=${r}`;

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
      <span className="text-amber-900">
        You have a saved location — pick up where you left off?
      </span>
      <div className="flex items-center gap-2">
        <Link
          href={href}
          className="rounded bg-amber-800 px-3 py-1 text-xs font-medium text-white hover:bg-amber-900"
        >
          Resume →
        </Link>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch {
              // non-fatal
            }
            setSaved(null);
          }}
          className="rounded px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
