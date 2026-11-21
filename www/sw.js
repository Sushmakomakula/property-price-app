// Caches the app and its data so it opens fast and works offline.
// Bump VERSION whenever the data files are refreshed.
const VERSION = "v2026-10-k";
const FILES = [
  "./", "index.html", "manifest.webmanifest",
  "lib/d3.min.js", "lib/topojson-client.min.js", "parcels.js", "propertylayer.js", "area.js", "lib/exceljs.min.js",
  "data/summary.json", "data/counties.json", "data/zips.json", "data/metros.json", "data/map.json",
  "icons/icon-192.png", "icons/icon-512.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) {
    // Live lookups (address search, property records) always go to the network.
    if (!url.hostname.endsWith("googleapis.com") && !url.hostname.endsWith("gstatic.com")) return;
    // Google Fonts: try the network, fall back to cache.
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
