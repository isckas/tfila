"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js on first client-side mount. Needed for PWA install
 * prompt eligibility (manifest + active service worker). The SW itself
 * is a no-op pass-through today (see public/sw.js); register here so
 * the registration shape is consistent across all pages without forcing
 * each page to opt in.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Don't register in dev — fast refresh + SW caching fight each other.
    if (process.env.NODE_ENV !== "production") return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[sw] registration failed", err);
    });
  }, []);

  return null;
}
