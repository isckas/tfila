"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STORAGE_KEY = "tfila.location";

interface SavedLocation {
  lat: number;
  lng: number;
  savedAt: number;
}

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

function persist(lat: number, lng: number) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lat, lng, savedAt: Date.now() } as SavedLocation),
    );
  } catch {
    // localStorage may be blocked (private mode etc) — non-fatal
  }
}

export function LocationGate() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<"idle" | "requesting" | "denied" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // On mount, if we have a saved location and the URL doesn't already carry
  // one, push it into the URL so the server can render the feed.
  useEffect(() => {
    if (params.get("lat") && params.get("lng")) return;
    const saved = readSaved();
    if (saved) {
      router.replace(`/?lat=${saved.lat}&lng=${saved.lng}`);
    }
    // intentionally only on mount
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
        persist(lat, lng);
        router.replace(`/?lat=${lat}&lng=${lng}`);
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
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Find minyanim near you</h2>
      <p className="mt-1 text-sm text-neutral-600">
        We need your location to show shuls within walking distance. It stays on
        your device — we don&apos;t save it on the server.
      </p>

      <div className="mt-5">
        <button
          type="button"
          onClick={requestLocation}
          disabled={status === "requesting"}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {status === "requesting" ? "Locating…" : "Use my location"}
        </button>
      </div>

      {status === "denied" && (
        <p className="mt-4 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          Permission denied. Re-enable location in your browser site settings,
          or pass <code>?lat=X&amp;lng=Y</code> directly in the URL.
        </p>
      )}
      {status === "error" && errorMsg && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {errorMsg}
        </p>
      )}

      <p className="mt-6 text-xs text-neutral-500">
        Tip: tfila.co works without an account. Bookmark this URL after granting
        location to skip this prompt next time.
      </p>
    </div>
  );
}
