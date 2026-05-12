"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "tfila.location";

function persist(lat: number, lng: number, radius: number) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lat, lng, radius, savedAt: Date.now() }),
    );
  } catch {
    // private mode / quota — non-fatal
  }
}

/**
 * "Find a minyan" card on the home landing. Embeds the location
 * button (primary CTA) plus a fallback address input (delegates to
 * the unified /api/search route).
 *
 * Does NOT auto-redirect on mount even if a saved location exists —
 * that broke the "click the logo to go home" flow. ResumeBanner
 * (separate component) renders a dismissible "resume to your saved
 * location" callout instead.
 */
export function FindCard() {
  const router = useRouter();
  const [status, setStatus] = useState<
    "idle" | "requesting" | "denied" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const requestLocation = () => {
    setStatus("requesting");
    setErrorMsg(null);
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setErrorMsg("Your browser doesn't expose geolocation.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const radius = 2;
        persist(lat, lng, radius);
        router.replace(`/?lat=${lat}&lng=${lng}&radius=${radius}`);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("denied");
        } else {
          setStatus("error");
          setErrorMsg(err.message || "Couldn't get your location.");
        }
      },
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  };

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden className="text-2xl">
          📍
        </span>
        <h2 className="text-lg font-semibold text-neutral-900">
          Find a minyan
        </h2>
      </div>
      <p className="mb-4 text-sm text-neutral-600">
        Show minyanim happening near you right now.
      </p>

      <button
        type="button"
        onClick={requestLocation}
        disabled={status === "requesting"}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {status === "requesting" ? "Locating…" : "Use my location"}
      </button>

      <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-wide text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200" />
        or enter an address
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      <form method="get" action="/api/search" className="flex gap-1.5">
        <input
          type="search"
          name="q"
          required
          placeholder="Address, zip, or city"
          className="w-full rounded border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Go
        </button>
      </form>

      {status === "denied" && (
        <p className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          Permission denied. Use the address input above, or enable location
          in your browser site settings.
        </p>
      )}
      {status === "error" && errorMsg && (
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {errorMsg}
        </p>
      )}
    </div>
  );
}
