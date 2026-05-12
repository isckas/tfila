"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STORAGE_KEY = "tfila.location";

interface SavedLocation {
  lat: number;
  lng: number;
  radius?: number;
  savedAt: number;
}

const RADIUS_OPTIONS = [0.5, 1, 2, 5, 10, 25];

function readSaved(): SavedLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedLocation;
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(lat: number, lng: number, radius: number) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lat, lng, radius, savedAt: Date.now() } as SavedLocation),
    );
  } catch {
    // private mode / quota — non-fatal
  }
}

export function LocationGate() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<"idle" | "requesting" | "denied" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [radius, setRadius] = useState<number>(2);

  // On mount: restore saved location if URL doesn't already have one.
  useEffect(() => {
    if (params.get("lat") && params.get("lng")) return;
    const saved = readSaved();
    if (saved) {
      const r = saved.radius ?? 2;
      router.replace(`/?lat=${saved.lat}&lng=${saved.lng}&radius=${r}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold text-neutral-900">
        Find a minyan
      </h2>

      {/* ─── Unified search ─────────────────────────────────── */}
      <form method="get" action="/api/search" className="mt-4 space-y-2">
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            required
            placeholder="Shul name, address, or city"
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-amber-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-900"
          >
            Search
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          A shul name (&ldquo;Aish Thornhill&rdquo;) finds that shul; a place
          (&ldquo;Upper West Side&rdquo;, &ldquo;10003&rdquo;) shows what&apos;s
          nearby.
        </p>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200" />
        or
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      {/* ─── Use my location with radius ────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={requestLocation}
          disabled={status === "requesting"}
          className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          <span aria-hidden>📍</span>
          {status === "requesting" ? "Locating…" : "Use my location"}
        </button>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <span>within</span>
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
          >
            {RADIUS_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r} mi
              </option>
            ))}
          </select>
        </label>
      </div>

      {status === "denied" && (
        <p className="mt-4 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          Permission denied. Use the search box above instead, or enable
          location in your browser site settings.
        </p>
      )}
      {status === "error" && errorMsg && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {errorMsg}
        </p>
      )}

      <p className="mt-5 text-xs text-neutral-500">
        Your location stays on your device — we don&apos;t save it on the
        server. Bookmark this URL after picking a location to skip this step
        next time.
      </p>
    </div>
  );
}
