// Offline: network-first for this site's files, cached copy when offline.
const CACHE = "potd-v4";
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "index.html", "style.css", "app.js", "js/dom.js", "js/sync.js", "js/speech.js", "js/watch.js", "js/learn.js", "js/settings.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-180.png"])).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try { const res = await fetch(req, { cache: "no-cache" }); if (res.ok) cache.put(req, res.clone()); return res; }
    catch { return (await cache.match(req, { ignoreSearch: true })) ?? (await cache.match("index.html")) ?? Response.error(); }
  })());
});
