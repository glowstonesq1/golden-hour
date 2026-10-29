// Service worker: offline cache and the share target. Built from this template by build.mjs.
const VERSION = '__VERSION__';
const CACHE = `gh-${VERSION}`;
const PRECACHE = __PRECACHE__;
const SHARE_CACHE = 'gh-share';
const SHARE_KEY = '/__shared__';
const MAX_SHARED_CHARS = 10000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// A share from WhatsApp or Messages arrives as a POST. It is answered here, on the device,
// so the shared text never reaches the network.
async function receiveShare(request) {
  const url = new URL(request.url);
  const prefix = url.pathname.slice(0, -'share-target/'.length);
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'POST' && url.pathname.endsWith('/share-target/')) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;
  // Cache first, so the 1930 page opens instantly and offline; the cache is replaced on every deploy.
  event.respondWith(
    caches.match(request, { ignoreSearch: url.searchParams.has('shared') }).then((hit) => hit || fetch(request)),
  );
});
