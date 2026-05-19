// Minimal service worker — required for PWA installability on iOS Safari
// and Android Chrome. Today this is a no-op pass-through (no offline cache,
// no precache, no push). Its job is to exist so the install prompt fires.
// Offline behavior (precache homepage, runtime cache shul pages) can be
// layered on top later without changing this registration shape.

const CACHE_VERSION = "tfila-v1";

self.addEventListener("install", (event) => {
  // Skip waiting so updates take effect on next page load instead of
  // requiring a tab close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clean up older caches when we bump CACHE_VERSION.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Pass-through fetch handler — required for installability per spec.
// Tells the browser this is a real, alive SW.
self.addEventListener("fetch", (event) => {
  // No-op: let the network handle everything. Add caching logic here
  // when offline support is wanted.
});
