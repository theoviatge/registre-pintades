// Garde l'appli dans le téléphone pour l'ouvrir sans connexion, et sert les photos / PDF rangés sur l'appareil.
// Les échanges avec la feuille Google ne passent pas par ce cache.
const CACHE = "pintades-gs-v2";
const FILES = ["./", "index.html", "config.js", "gs.js",
  "manifest.webmanifest", "icon-192.png", "icon-512.png", "html2canvas.min.js", "jspdf.umd.min.js"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

function blobFromDb(id) {
  return new Promise((res, rej) => {
    const r = indexedDB.open("registre-pintades-sheets", 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ["docs", "meta", "blobs"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    r.onerror = () => rej(r.error);
    r.onsuccess = () => { const q = r.result.transaction("blobs").objectStore("blobs").get(id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); };
  });
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  const same = url.origin === location.origin, fonts = /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  const m = same && url.pathname.match(/\/_blob\/([0-9a-f]+)$/);
  if (m) {
    e.respondWith(blobFromDb(m[1]).then(b => b ? new Response(b.data, { headers: { "Content-Type": b.type } }) : new Response("Ce fichier a été fait sur un autre appareil : il n'est pas sur celui-ci.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
    return;
  }
  if (e.request.method !== "GET" || !(same || fonts)) return;
  // Page de l'appli : on prend la version en ligne d'abord (mises à jour visibles tout de suite), le cache seulement sans réseau.
  if (same && (e.request.mode === "navigate" || /\/(index\.html)?$/.test(url.pathname))) {
    e.respondWith(caches.open(CACHE).then(async c => {
      try {
        const r = await Promise.race([fetch(e.request, { cache: "no-store" }), new Promise((_, rej) => setTimeout(() => rej(new Error("lent")), 5000))]);
        if (r && r.ok) { c.put("index.html", r.clone()); return r; }
      } catch (_) {}
      return (await c.match("index.html")) || (await c.match(e.request, { ignoreSearch: true })) || new Response("Hors ligne", { status: 504 });
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || (e.request.mode === "navigate" ? c.match("index.html") : new Response("", { status: 504 }));
  }));
});
