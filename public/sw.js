/**
 * Minimal service worker for the cafe's counter phone.
 *
 * Scope is deliberately small (theme doc §6: the page must load fast on cafe
 * wifi). There is no build step and no workbox here on purpose:
 *
 *   - navigations: network-first with an offline fallback, so staff always get
 *     live data when there is a connection and still get *something* when there
 *     isn't;
 *   - static assets under /_next/static: cache-first (they are immutable and
 *     content-hashed, so this is safe);
 *   - icons: stale-while-revalidate.
 *
 * Deliberately NOT cached: Firestore/Auth traffic (always network) and anything
 * under /staff or /admin, which must never show a stale order board.
 */

const VERSION = "v1";
const SHELL_CACHE = `cafe-shell-${VERSION}`;
const ASSET_CACHE = `cafe-assets-${VERSION}`;

const PRECACHE = ["/offline", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isLiveOnly(url) {
  return (
    url.pathname.startsWith("/staff") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/api/") ||
    url.hostname.endsWith("googleapis.com") ||
    url.hostname.endsWith("firebaseio.com") ||
    url.hostname.endsWith("firebasestorage.googleapis.com")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never serve live data from cache.
  if (isLiveOnly(url)) return;

  // Immutable build output: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Navigations: network-first, offline page as the fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/offline");
        }),
    );
    return;
  }

  // Icons and other same-origin assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => hit);
        return hit || network;
      }),
    );
  }
});
