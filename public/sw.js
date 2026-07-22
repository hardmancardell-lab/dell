// Installability only, deliberately not an offline cache — this app's data
// is always real/live or explicitly mock-labeled; a service worker that
// silently served stale cached quotes/prices offline would violate that.
// The empty fetch handler is a no-op passthrough, present only because some
// browsers' "installable" heuristics look for one.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
