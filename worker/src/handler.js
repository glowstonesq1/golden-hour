// The link checker's request handler. Every outside dependency (fetch, the browser, the limits store,
// the clock) comes in through `deps`, so tests run it with stubs; index.js passes the real ones.
// It never logs the URL it checks.
import { stripUrl, followChain, assertPublicHost, Blocked } from './guard.js';
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

// Limits: per visitor (a salted daily hash of the IP, never the IP itself) and a global daily budget of
// browser seconds that keeps the Workers free plan's browser time. KV is eventually consistent, so the
// limits are approximate; the browser budget is checked before every launch.
async function overLimit(env, deps, ip) {
  const today = day(deps.now());
  const key = `ip:${await sha256(`${env.SALT || ''}:${today}:${ip}`)}`;
  const used = Number((await deps.kv.get(key)) || 0);
  if (used >= Number(env.PER_IP_DAILY || 10)) return true;
  const seconds = Number((await deps.kv.get(`browser:${today}`)) || 0);
  if (seconds >= Number(env.DAILY_BROWSER_SECONDS || 540)) return true;
  await deps.kv.put(key, String(used + 1), { expirationTtl: 172800 });
  return false;
}
async function spend(env, deps, seconds) {
  const k = `browser:${day(deps.now())}`;
  const used = Number((await deps.kv.get(k)) || 0);
  await deps.kv.put(k, String(Math.ceil(used + seconds)), { expirationTtl: 172800 });
}

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

  let chain;
  try {
    chain = await followChain(url, { fetchFn: deps.fetch, dnsFetch: deps.fetch });
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
    const res = await deps.fetch(`https://rdap.org/domain/${encodeURIComponent(site)}`, { headers: { accept: 'application/rdap+json' } });
    if (res.ok) ageDays = domainAgeDays(await res.json(), deps.now());
  } catch {
    // RDAP is optional
  }
  const inTopList = deps.topSites ? deps.topSites.has(site) : null;
  if (ageDays !== null && ageDays < YOUNG_DAYS && !inTopList) signals.push('youngDomain');

  let screenshot = null;
  let finalUrl = chain.final;
  if (chain.html) {
    const started = deps.now();
    try {
      const page = await deps.browse(chain.final, async (requestUrl) => {
        // Every request the page makes (redirects, scripts, images) is checked the same way.
        const u = new URL(requestUrl);
        if (!['http:', 'https:', 'data:'].includes(u.protocol)) return false;
        if (u.protocol === 'data:') return true;
        try {
          await assertPublicHost(u.hostname, deps.fetch);
          return true;
        } catch {
          return false;
        }
      });
      screenshot = page.screenshot;
      finalUrl = page.url || finalUrl;
      for (const s of formSignals(page.forms, finalUrl)) if (!signals.includes(s)) signals.push(s);
      if (page.download && !signals.includes('download')) signals.push('download');
    } catch {
      // The redirect chain and domain facts still help even when the page will not render.
    } finally {
      await spend(env, deps, (deps.now() - started) / 1000);
    }
  }

  return json(200, { finalUrl, chain: chain.chain, screenshot, signals, ageDays, inTopList }, allowed);
}
