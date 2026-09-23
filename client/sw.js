// Minimal service worker: exists only so the browser considers this app
// "installable" as a PWA. It intentionally does NOT cache anything, so a
// new deploy is always picked up immediately (no stale-JS surprises).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op: let the browser handle every request normally (network).
});
