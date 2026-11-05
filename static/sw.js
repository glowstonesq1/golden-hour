// Service worker: offline cache and the share target. Built from this template by build.mjs.
const VERSION = '__VERSION__';
const CACHE = `gh-${VERSION}`;
const PRECACHE = __PRECACHE__;
const PREFIXES = __PREFIXES__; // one per language, e.g. "/", "/hi/"
const MAX_SHARED_CHARS = 10000;
const MAX_SHARED_FILES = 20;
// The OCR engine and language data are fetched on first use and kept here. The name follows the vendored
// Tesseract.js version, so a new deploy does not throw away 7 MB the phone already has.
const OCR_CACHE = 'gh-ocr-7.0.0';
const isOcr = (pathname) => pathname.startsWith('/vendor/') || pathname === '/ocr.js';
const SHARE_TTL_MS = 2 * 60 * 1000;
// A received share waits here, in memory only, until the page that opens next asks for it.
let pending = null;

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the HTTP cache so a deploy never precaches stale files.
  // addAll is all-or-nothing: on failure the old worker stays and the browser retries later.
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Also removes the old 'gh-share' cache that held shared text before shares moved to memory.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only the exact share paths from the manifests are handled, so no other page can use this as a redirect.
const sharePrefix = (pathname) => PREFIXES.find((p) => pathname === `${p}share-target/`);

// A share from WhatsApp or Messages arrives as a POST. It is answered here, on the device,
// so the shared text never reaches the network or any storage. The next page load takes it.
// Text goes to Check; files (screenshots, a chat export) go to the proof step of the journey.
async function receiveShare(request, prefix) {
  let text = '';
  let files = [];
  try {
    const form = await request.formData();
    text = ['title', 'text', 'url']
      .map((k) => form.get(k))
      .filter((v) => typeof v === 'string' && v.trim())
      .join('\n')
      .slice(0, MAX_SHARED_CHARS);
    files = form.getAll('files').filter((f) => typeof f === 'object' && f && f.size > 0).slice(0, MAX_SHARED_FILES);
  } catch {
    // Malformed share: open the Check page empty rather than fail.
  }
  pending = { text, files, at: Date.now() };
  return Response.redirect(files.length ? `${prefix}help/?shared=1#step-proof` : `${prefix}check/?shared=1`, 303);
}

// Pages ask once on load. The share is handed over and forgotten in the same step, so a later page,
// or a page opened long after, never sees it.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'take-share' || !event.ports?.[0]) return;
  const fresh = pending && Date.now() - pending.at < SHARE_TTL_MS;
  event.ports[0].postMessage(fresh ? { text: pending.text, files: pending.files } : { text: '', files: [] });
  pending = null;
});

// OCR files: cache first, filled on first use. Only complete, successful responses are kept.
async function fromOcrCache(request) {
  const cache = await caches.open(OCR_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200) await cache.put(request, res.clone());
  return res;
}

async function fromCache(request) {
  const url = new URL(request.url);
  const cache = await caches.open(CACHE);
  // Pages are static, so a query string (?shared=1, ?utm_source=...) never changes them.
  const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch (err) {
    if (request.mode !== 'navigate') throw err;
    // Offline and the page is unknown: open that language's home, which has the 1930 button.
    const prefix = PREFIXES.filter((p) => url.pathname.startsWith(p)).sort((a, b) => b.length - a.length)[0] || '/';
    return (await cache.match(prefix)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'POST') {
    const prefix = sharePrefix(url.pathname);
    if (prefix) event.respondWith(receiveShare(request, prefix));
    return;
  }
  if (request.method !== 'GET') return;
  event.respondWith(isOcr(url.pathname) ? fromOcrCache(request) : fromCache(request));
});
