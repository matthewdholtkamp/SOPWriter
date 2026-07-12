const manifest = self.__WB_MANIFEST;
const cacheKey = manifest
  .map((entry) => (typeof entry === "string" ? entry : `${entry.url}:${entry.revision ?? ""}`))
  .join("|");
const cacheHash = [...cacheKey].reduce(
  (hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0,
  0
);
const cacheName = `sopwriter-${cacheHash.toString(16)}`;
const precacheUrls = manifest.map((entry) => (typeof entry === "string" ? entry : entry.url));
const appShellUrl = new URL("index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.addAll(precacheUrls))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("sopwriter-") && key !== cacheName).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(appShellUrl)) ?? Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request))
  );
});
