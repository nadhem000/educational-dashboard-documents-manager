/* ============================================================
   Documents Manager — Service Worker
   ------------------------------------------------------------
   Strategy:
     • App shell (HTML / icons / manifest) → cache-first, then
       network, with a stale-while-revalidate refresh in the
       background on subsequent visits.
     • /api/*  → network-only. TTS responses are never cached:
       they're per-request audio, they blow the storage quota,
       and an offline miss should just fail fast.
     • Everything else → network, falling back to cache, then
       to the offline page.

   Bump CACHE_VERSION on every deploy that changes any file in
   PRECACHE. The install handler will fetch fresh copies and the
   activate handler will delete the old cache.
   ============================================================ */

const CACHE_VERSION = 'v1';
const CACHE_NAME    = `dm-${CACHE_VERSION}`;

/* Files that must be available offline. Keep this list short and
   limited to files that live in the repo — the maths_*.html files
   from another project are NOT here. */
const PRECACHE = [
  '/',
  '/index.html',
  '/dm_voiceStudio.html',
  '/dm_voiceStudio_TTS.html',
  '/dm_voiceStudio_VS.html',
  '/manifest.json',
  '/assets/icons/icon-152x152.png',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-512x512.png',
];

/* Paths that must never be served from cache. */
const NETWORK_ONLY = [
  '/api/',
];

/* ---------- install ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll rejects the whole batch on a single 404, so fetch
      // each entry individually and tolerate failures.
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (err) {
            console.warn('[sw] precache miss:', url, err);
          }
        })
      );
      // Take over as soon as possible so the first page load after
      // install is already controlled.
      await self.skipWaiting();
    })()
  );
});

/* ---------- activate ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('dm-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------- fetch ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only GET is cacheable in any meaningful sense here.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin only. Never intercept third-party requests
  // (Google TTS, fonts, etc.) — let them hit the network directly.
  if (url.origin !== self.location.origin) return;

  // Network-only for the TTS API.
  if (NETWORK_ONLY.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(fetch(req));
    return;
  }

  // Navigation requests (the user typing a URL or clicking a link
  // that opens a new document) — fall back to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
    return;
  }

  // Everything else (CSS, JS, images, manifest) — cache-first with
  // a background refresh.
  event.respondWith(handleAsset(req));
});

/* ---------- handlers ---------- */

async function handleNavigate(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last resort: serve the hub so the user isn't stuck on the
    // browser's offline error page.
    const shell = await cache.match('/index.html');
    if (shell) return shell;
    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function handleAsset(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  // Kick off a background refresh regardless, so the next visit
  // gets the newest copy without blocking this one.
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) return cached;

  const fresh = await network;
  if (fresh) return fresh;

  return new Response('', { status: 504, statusText: 'Offline' });
}

/* ---------- messages from the page ---------- */

/* The page can post { type: 'SKIP_WAITING' } to force the waiting
   worker to activate immediately (used by the update prompt). */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});