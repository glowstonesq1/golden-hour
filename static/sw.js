// Service worker: offline cache and the share target. Built from this template by build.mjs.
const VERSION = '__VERSION__';
const CACHE = `gh-${VERSION}`;
const PRECACHE = __PRECACHE__;
const PREFIXES = __PREFIXES__; // one per language, e.g. "/", "/hi/"
const SHARE_CACHE = 'gh-share';
const SHARE_KEY = '/__shared__';
const MAX_SHARED_CHARS = 10000;

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only the exact share paths from the manifests are handled, so no other page can use this as a redirect.
const sharePrefix = (pathname) => PREFIXES.find((p) => pathname === `${p}share-target/`);

// A share from WhatsApp or Messages arrives as a POST. It is answered here, on the device,
// so the shared text never reaches the network. The Check page deletes it as soon as it loads.
async function receiveShare(request, prefix) {
  let text = '';
  try {
    const form = await request.formData();
    text = ['title', 'text', 'url']
      .map((k) => form.get(k))
      .filter((v) => typeof v === 'string' && v.trim())
      .join('\n')
      .slice(0, MAX_SHARED_CHARS);
  } catch {
    // Malformed share: open the Check page empty rather than fail.
  }
  const cache = await caches.open(SHARE_CACHE);
  await cache.put(SHARE_KEY, new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  return Response.redirect(`${prefix}check/?shared=1`, 303);
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
  event.respondWith(fromCache(request));
});
