// Service worker: app utilizzabile senza rete + cache delle mappe gia' viste
const VERSION = 'v1.1.1';
const APP_CACHE = 'rb-app-' + VERSION;
const TILE_CACHE = 'rb-tiles';
const TILE_MAX = 6000; // numero massimo di tasselli tenuti in memoria

const APP_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/gps.js', 'js/catalog.js', 'js/icons.js', 'js/wizard.js', 'js/settings.js', 'js/export.js', 'js/util.js', 'js/transit.js', 'js/events.js', 'js/tunnel.js', 'js/telemetry.js', 'js/voice.js',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/jszip.min.js', 'vendor/xlsx.full.min.js', 'vendor/togeojson.js',
  'icons/icon-192.png', 'icons/icon-512.png',
  'loghi/carburanti/beyfin.png', 'loghi/carburanti/bianca.png', 'loghi/carburanti/eni.png', 'loghi/carburanti/esso.png', 'loghi/carburanti/ip.png', 'loghi/carburanti/q8.png',
  'loghi/carburanti/shell.png', 'loghi/carburanti/tamoil.png', 'loghi/reg/co.png', 'loghi/reg/ct.png', 'loghi/reg/fpm.png', 'loghi/reg/ipc.png',
  'loghi/reg/ipm.png', 'loghi/reg/preipm.png', 'loghi/sport/co.png', 'loghi/sport/ct.png', 'loghi/sport/fine.png', 'loghi/sport/int.png',
  'loghi/sport/intplus.png', 'loghi/sport/media.png', 'loghi/sport/parco.png', 'loghi/sport/refuel.png', 'loghi/sport/start.png', 'loghi/sport/stop.png',
  'loghi/sport/sz-fine.png', 'loghi/sport/sz-in.png', 'loghi/sport/tyre.png', 'loghi/sport/vc-fine.png', 'loghi/sport/vc-in.png'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' = prende sempre i file nuovi dal server, mai copie vecchie del browser
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('rb-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isTile = (url) => /tile\.openstreetmap\.org|opentopomap\.org|arcgisonline\.com|mt\d?\.google\.com/.test(url.hostname);

let trimming = false;
async function trimTiles() {
  if (trimming) return; trimming = true;
  try {
    const c = await caches.open(TILE_CACHE);
    const keys = await c.keys();
    const extra = keys.length - TILE_MAX;
    for (let i = 0; i < extra; i++) await c.delete(keys[i]);
  } finally { trimming = false; }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isTile(url)) {
    // mappe: prima dalla memoria, poi dalla rete
    e.respondWith(caches.open(TILE_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); if (Math.random() < 0.02) trimTiles(); }
        return res;
      } catch (err) { return new Response('', { status: 504 }); }
    }));
    return;
  }

  if (url.origin === location.origin) {
    // file dell'app: rete se c'e' (cosi' prende gli aggiornamenti), altrimenti memoria
    // 'no-cache' = chiede sempre al server se il file e' cambiato (evita stili/script vecchi)
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const cl = res.clone(); caches.open(APP_CACHE).then((c) => c.put(req, cl)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  }
});
