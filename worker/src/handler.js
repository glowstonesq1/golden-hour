// The link checker's request handler. Every outside dependency (fetch, the browser, the limits store,
// the clock) comes in through `deps`, so tests run it with stubs; index.js passes the real ones.
// It never logs the URL it checks.
import { stripUrl, followChain, assertPublicHost, Blocked, PORTS, v6parts } from './guard.js';
import { formSignals, domainAgeDays, registrable, YOUNG_DAYS } from './signals.js';

const json = (status, body, origin) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
  },
});

const day = (now) => now.toISOString().slice(0, 10);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Limits: per visitor (a salted daily hash of the IP, never the IP itself; IPv6 per /64, since one
// connection usually holds a whole /64) and a global daily budget of browser seconds that keeps the free
// plan's browser time. KV is eventually consistent and not atomic, so parallel requests can slip past
// both limits; the Rate Limiting binding or a Durable Object would make them exact (worker/README.md).
const visitor = (ip) => {
  const p = ip.includes(':') ? v6parts(ip) : null;
  return p ? p.slice(0, 4).map((x) => x.toString(16)).join(':') : ip;
};
async function kvGet(deps, key) {
  try {
    return Number((await deps.kv.get(key)) || 0);
  } catch {
    return Infinity; // the store cannot be read: refuse rather than run without limits
  }
}
async function kvPut(deps, key, value) {
  try {
    await deps.kv.put(key, String(Math.max(0, Math.ceil(value))), { expirationTtl: 172800 });
  } catch {
    // KV allows one write per second per key; a lost increment only loosens an approximate limit
  }
}
async function overLimit(env, deps, ip) {
  const today = day(deps.now());
  const key = `ip:${await sha256(`${env.SALT || ''}:${today}:${visitor(ip)}`)}`;
  const used = await kvGet(deps, key);
  if (used >= Number(env.PER_IP_DAILY || 10)) return true;
  if ((await kvGet(deps, `browser:${today}`)) >= Number(env.DAILY_BROWSER_SECONDS || 540)) return true;
  await kvPut(deps, key, used + 1);
  return false;
}
const spend = async (deps, seconds) => {
  const k = `browser:${day(deps.now())}`;
  await kvPut(deps, k, (await kvGet(deps, k)) + seconds);
};

export async function handle(request, env, deps) {
  const origin = request.headers.get('origin') || '';
  const allowed = origin && origin === env.ALLOWED_ORIGIN ? origin : '';
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: allowed ? 204 : 403, headers: allowed ? {
      'access-control-allow-origin': allowed, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'Origin',
    } : {} });
  }
  if (!allowed) return json(403, { error: 'origin' });
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/check') return json(404, { error: 'not found' }, allowed);
  if (!deps.kv) return json(503, { error: 'not configured' }, allowed);

  let url;
  try {
    const body = await request.json();
    url = stripUrl(body?.url); // stripped again here, whatever the app sent
  } catch (err) {
    return json(400, { error: err instanceof Blocked ? 'bad url' : 'bad request' }, allowed);
  }
  if (await overLimit(env, deps, request.headers.get('cf-connecting-ip') || '')) return json(429, { error: 'try later' }, allowed);

  // One DNS check per host per request: redirect hops and page requests share it.
  const hosts = new Map();
  const checkHost = (h) => {
    if (!hosts.has(h)) hosts.set(h, assertPublicHost(h, deps.fetch));
    return hosts.get(h);
  };

  let chain;
  try {
    chain = await followChain(url, { fetchFn: deps.fetch, dnsFetch: deps.fetch, checkHost });
  } catch (err) {
    return json(err instanceof Blocked ? 403 : 502, { error: err instanceof Blocked ? 'blocked' : 'unreachable' }, allowed);
  }

  const signals = [];
  if (chain.apk) signals.push('apkDownload');
  if (chain.download) signals.push('download');

  // Domain age and the top-sites list are about the final site, not the victim.
  const site = registrable(new URL(chain.final).hostname);
  let ageDays = null;
  try {
    const res = await deps.fetch(`https://rdap.org/domain/${encodeURIComponent(site)}`, { headers: { accept: 'application/rdap+json' }, signal: AbortSignal.timeout(5000) });
    if (res.ok) ageDays = domainAgeDays(await res.json(), deps.now());
  } catch {
    // RDAP is optional
  }
  const inTopList = deps.topSites ? deps.topSites.has(site) : null;
  if (ageDays !== null && ageDays < YOUNG_DAYS && !inTopList) signals.push('youngDomain');

  let screenshot = null;
  let finalUrl = chain.final;
  if (chain.html) {
    // The browser time is reserved before launch and the unused part refunded after, so a page that hangs
    // is still charged; a hard deadline stops waiting for it.
    const reserve = Number(env.BROWSE_SECONDS || 20);
    await spend(deps, reserve);
    const started = deps.now();
    let timer;
    try {
      const page = await Promise.race([
        deps.browse(chain.final, async (requestUrl) => {
          // Every HTTP request the page makes (redirects, frames, scripts, images) is checked the same way;
          // index.js switches off the connections interception cannot see (WebSocket, WebRTC, workers).
          const u = new URL(requestUrl);
          if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
          if (!['http:', 'https:'].includes(u.protocol) || !PORTS.has(u.port)) return false;
          try {
            await checkHost(u.hostname);
            return true;
          } catch {
            return false;
          }
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('page took too long')), reserve * 1000); }),
      ]);
      screenshot = page.screenshot;
      finalUrl = page.url || finalUrl;
      for (const s of formSignals(page.forms, finalUrl)) if (!signals.includes(s)) signals.push(s);
      if (page.download && !signals.includes('download')) signals.push('download');
    } catch {
      // The redirect chain and domain facts still help even when the page will not render.
    } finally {
      clearTimeout(timer);
      await spend(deps, Math.min(0, (deps.now() - started) / 1000 - reserve)); // refund what was not used
    }
  }

  return json(200, { finalUrl, chain: chain.chain, screenshot, signals, ageDays, inTopList }, allowed);
}
