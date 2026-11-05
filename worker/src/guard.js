// SSRF guard for the link checker: which URLs may be fetched, and which addresses they may reach.
// Pure functions; DNS and fetch are passed in, so tests run without a network.

export const PORTS = new Set(['', '80', '443', '8080', '8443']);
export const MAX_HOPS = 10;
const TIMEOUT_MS = 5000; // every DNS, redirect and RDAP call gives up after this

export class Blocked extends Error {}

// The only part of the victim's link that ever reaches the worker: scheme, host and path.
// Query strings and fragments often carry a per-victim token or personal data, so they are dropped.
export function stripUrl(input) {
  let u;
  try {
    u = new URL(String(input ?? '').trim());
  } catch {
    throw new Blocked('not a URL');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Blocked('only http and https');
  if (u.username || u.password) throw new Blocked('credentials in URL');
  if (!PORTS.has(u.port)) throw new Blocked('port not allowed');
  u.search = '';
  u.hash = '';
  const out = u.toString();
  if (out.length > 2048) throw new Blocked('URL too long');
  return out;
}

// ---------- Addresses ----------
const v4num = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const inV4 = (ip, base, bits) => (v4num(ip) >>> (32 - bits)) === (v4num(base) >>> (32 - bits));
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const isV4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((p) => Number(p) <= 255);

// Expands an IPv6 address to eight 16-bit numbers, or null if it is not one.
export function v6parts(s) {
  let ip = s.replace(/^\[|\]$/g, '').toLowerCase().split('%')[0];
  const tail = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    if (!isV4(tail[1])) return null;
    const n = v4num(tail[1]);
    ip = `${ip.slice(0, -tail[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/.test(ip) || (ip.match(/::/g) || []).length > 1) return null;
  const [head, rest] = ip.includes('::') ? ip.split('::') : [ip, null];
  const a = head ? head.split(':') : [];
  const b = rest ? rest.split(':') : [];
  const fill = rest === null ? 0 : 8 - a.length - b.length;
  if (fill < 0) return null;
  const parts = [...a, ...Array(fill).fill('0'), ...b];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

export function isPublicAddress(addr) {
  const s = String(addr ?? '').trim();
  if (isV4(s)) return !V4_BLOCKED.some(([base, bits]) => inV4(s, base, bits)) && s !== '255.255.255.255';
  const p = v6parts(s);
  if (!p) return false;
  const embedded = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (p.slice(0, 5).every((x) => x === 0) && p[5] === 0xffff) return isPublicAddress(embedded(p[6], p[7])); // ::ffff:a.b.c.d
  if (p[0] === 0x64 && p[1] === 0xff9b && p.slice(2, 6).every((x) => x === 0)) return isPublicAddress(embedded(p[6], p[7])); // NAT64
  if (p[0] === 0x2002) return isPublicAddress(embedded(p[1], p[2])); // 6to4
  if (p.every((x) => x === 0) || (p.slice(0, 7).every((x) => x === 0) && p[7] === 1)) return false; // :: and ::1
  if (p.slice(0, 6).every((x) => x === 0)) return false; // old IPv4-compatible ::a.b.c.d
  if ((p[0] & 0xe000) !== 0x2000) return false; // only global unicast 2000::/3 is public
  if (p[0] === 0x2001 && p[1] < 0x0200) return false; // 2001::/23 protocol assignments (Teredo, ORCHID, ...)
  if (p[0] === 0x2001 && p[1] === 0x0db8) return false; // documentation
  if (p[0] === 0x3fff && p[1] < 0x1000) return false; // documentation (3fff::/20)
  return true;
}

// ---------- DNS over HTTPS ----------
// Resolves every A and AAAA record; the host is allowed only if all of them are public.
export async function resolveHost(host, fetchFn, doh = 'https://cloudflare-dns.com/dns-query') {
  const name = host.replace(/^\[|\]$/g, '');
  if (isV4(name) || v6parts(name)) return [name];
  const answers = [];
  for (const type of ['A', 'AAAA']) {
    const res = await fetchFn(`${doh}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error('DNS lookup failed');
    const data = await res.json();
    for (const a of data.Answer || []) if (a.type === 1 || a.type === 28) answers.push(String(a.data));
  }
  if (!answers.length) throw new Error('host does not resolve');
  return answers;
}

export async function assertPublicHost(host, fetchFn) {
  const addrs = await resolveHost(host, fetchFn);
  const bad = addrs.find((a) => !isPublicAddress(a));
  if (bad) throw new Blocked(`resolves to a non-public address`);
  return addrs;
}

// ---------- Redirects ----------
// Follows redirects by hand, re-checking every hop, without downloading bodies. Stops at an app file or download.
export async function followChain(start, { fetchFn, dnsFetch = fetchFn, maxHops = MAX_HOPS, checkHost = (h) => assertPublicHost(h, dnsFetch) }) {
  const chain = [];
  let url = start;
  for (let hop = 0; hop <= maxHops; hop++) {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Blocked('redirect to a non-web address');
    if (u.username || u.password || !PORTS.has(u.port)) throw new Blocked('redirect to a disallowed address');
    await checkHost(u.hostname);
    chain.push(url);
    const res = await fetchFn(url, { redirect: 'manual', method: 'GET', headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) GoldenHourLinkCheck' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel?.();
      url = new URL(location, url).toString();
      continue;
    }
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const disposition = (res.headers.get('content-disposition') || '').toLowerCase();
    await res.body?.cancel?.(); // never download the body
    const apk = type.includes('application/vnd.android.package-archive') || /\.apk$/i.test(u.pathname) || /\.apk\b/.test(disposition);
    const html = /text\/html|application\/xhtml/.test(type);
    return { final: url, chain, status: res.status, apk, download: !apk && (disposition.startsWith('attachment') || (!html && !!type && !type.startsWith('text/'))), html };
  }
  throw new Blocked('too many redirects');
}
