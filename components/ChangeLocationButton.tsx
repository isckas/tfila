"use client";

import { useRouter } from "next/navigation";

const STORAGE_KEY = "tfila.location";

/**
 * Clears the saved location from localStorage and navigates to `/`.
 * Without this, the LocationGate's auto-redirect would bounce the
 * user back to the same coords immediately.
 */
export function ChangeLocationButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // private mode etc — non-fatal
        }
        router.push("/");
      }}
      className="text-xs text-neutral-500 underline-offset-2 hover:underline"
    >
      change location
    </button>
  );
}
