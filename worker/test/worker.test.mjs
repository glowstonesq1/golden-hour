// Link checker tests with local stubs: no Cloudflare, no network, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripUrl, isPublicAddress, resolveHost, followChain, Blocked } from '../src/guard.js';
import { formSignals, domainAgeDays, registrable } from '../src/signals.js';
import { handle } from '../src/handler.js';

// A fake internet: DNS answers and HTTP responses by URL.
function net({ dns = {}, pages = {} } = {}) {
  const seen = [];
  const fetchFn = async (url, init = {}) => {
    seen.push(url);
    const u = new URL(url);
    if (u.hostname === 'cloudflare-dns.com') {
      const name = u.searchParams.get('name');
      const type = u.searchParams.get('type');
      const addrs = (dns[name] || []).filter((a) => (type === 'A') === !a.includes(':'));
      return Response.json({ Answer: addrs.map((data) => ({ type: type === 'A' ? 1 : 28, data })) });
    }
    if (u.hostname === 'rdap.org') return pages[url] ? Response.json(pages[url]) : new Response('', { status: 404 });
    const p = pages[url] || { status: 200, headers: { 'content-type': 'text/html' } };
    return new Response(p.body ?? '', { status: p.status, headers: p.headers });
  };
  return { fetchFn, seen };
}

test('stripUrl: keeps scheme, host and path; drops query and fragment; refuses everything else', () => {
  assert.equal(stripUrl('https://sbi-kyc.example/login?id=9123456780&t=abc#otp'), 'https://sbi-kyc.example/login');
  assert.equal(stripUrl('http://bit.ly/Xy7k'), 'http://bit.ly/Xy7k');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.example/', 'https://user:pass@x.example/', 'https://x.example:22/', 'not a url', '']) {
    assert.throws(() => stripUrl(bad), Blocked, bad);
  }
});

test('addresses: private, loopback, link-local, CGNAT, multicast, reserved and documentation ranges are refused', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '240.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:c0a8:0101::1', '2001:db8::1', '2001::1', '[::1]', '::127.0.0.1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '103.21.244.1', '172.32.0.1', '2606:4700:4700::1111', '2404:6800:4009:80b::200e', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  assert.equal(isPublicAddress('not-an-ip'), false);
  assert.equal(new URL('http://2130706433/').hostname, '127.0.0.1', 'odd IPv4 spellings are normalised by URL first');
});

test('DNS: a name is allowed only if every A and AAAA record is public', async () => {
  const { fetchFn } = net({ dns: { 'ok.example': ['93.184.216.34'], 'rebind.example': ['93.184.216.34', '10.0.0.5'], 'v6.example': ['::1'] } });
  assert.deepEqual(await resolveHost('ok.example', fetchFn), ['93.184.216.34']);
  await assert.rejects(followChain('https://rebind.example/', { fetchFn }), Blocked, 'one private answer is enough to refuse');
  await assert.rejects(followChain('https://v6.example/', { fetchFn }), Blocked);
  await assert.rejects(followChain('https://nxdomain.example/', { fetchFn }), /does not resolve/);
  await assert.rejects(followChain('http://169.254.169.254/latest/meta-data/', { fetchFn }), Blocked, 'cloud metadata address');
});

test('redirects: every hop is re-checked, a hop to a private address is refused, at most 10 hops', async () => {
  const dns = { 'short.example': ['93.184.216.34'], 'mid.example': ['93.184.216.35'], 'evil.example': ['127.0.0.1'], 'end.example': ['93.184.216.36'] };
  let n = net({ dns, pages: {
    'https://short.example/a': { status: 301, headers: { location: 'https://mid.example/b?x=1' } },
    'https://mid.example/b?x=1': { status: 302, headers: { location: '/c' } },
    'https://mid.example/c': { status: 302, headers: { location: 'https://end.example/login' } },
    'https://end.example/login': { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  } });
  const r = await followChain('https://short.example/a', { fetchFn: n.fetchFn });
  assert.deepEqual(r.chain, ['https://short.example/a', 'https://mid.example/b?x=1', 'https://mid.example/c', 'https://end.example/login']);
  assert.equal(r.final, 'https://end.example/login');
  assert.ok(r.html && !r.apk && !r.download);

  n = net({ dns, pages: { 'https://short.example/a': { status: 302, headers: { location: 'http://evil.example/admin' } } } });
  await assert.rejects(followChain('https://short.example/a', { fetchFn: n.fetchFn }), Blocked);
  assert.ok(!n.seen.includes('http://evil.example/admin'), 'the private host is never fetched');

  n = net({ dns, pages: { 'https://short.example/a': { status: 302, headers: { location: 'http://10.1.2.3/' } } } });
  await assert.rejects(followChain('https://short.example/a', { fetchFn: n.fetchFn }), Blocked, 'redirect to a private IP literal');

  const loop = {};
  for (let i = 0; i < 12; i++) loop[`https://short.example/${i}`] = { status: 302, headers: { location: `https://short.example/${i + 1}` } };
  n = net({ dns, pages: loop });
  await assert.rejects(followChain('https://short.example/0', { fetchFn: n.fetchFn }), /too many redirects/);
});

test('downloads are recorded as signals and never fetched past the headers', async () => {
  const dns = { 'dl.example': ['93.184.216.34'] };
  let r = await followChain('https://dl.example/SBI.apk', { fetchFn: net({ dns, pages: { 'https://dl.example/SBI.apk': { status: 200, headers: { 'content-type': 'application/vnd.android.package-archive' } } } }).fetchFn });
  assert.ok(r.apk && !r.download && !r.html);
  r = await followChain('https://dl.example/f', { fetchFn: net({ dns, pages: { 'https://dl.example/f': { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="x.bin"' } } } }).fetchFn });
  assert.ok(r.download && !r.apk);
});

test('page signals: OTP, UPI PIN, card, Aadhaar, and a password sent to another site', () => {
  const forms = [
    { action: 'https://collect.other.example/post', fields: [{ type: 'password', name: 'pwd' }, { type: 'text', name: 'otp_code' }] },
    { action: '', fields: [{ type: 'tel', placeholder: 'Enter UPI PIN' }, { type: 'text', autocomplete: 'cc-number' }, { type: 'text', label: 'Aadhaar number' }] },
    { action: '', fields: [{ type: 'text', placeholder: 'Pin code' }] },
  ];
  assert.deepEqual(formSignals(forms, 'https://sbi-kyc.example/login').sort(), ['aadhaarForm', 'cardForm', 'otpForm', 'passwordOffsite', 'pinForm']);
  assert.deepEqual(formSignals([{ action: '/login', fields: [{ type: 'password' }] }], 'https://shop.example/'), [], 'a password to the same site is normal');
  assert.deepEqual(formSignals([{ action: '', fields: [{ type: 'text', placeholder: 'PIN code' }] }], 'https://shop.example/'), [], 'a postal pin code is not a UPI PIN');
  assert.equal(registrable('www.fake-sbi.co.in'), 'fake-sbi.co.in');
  assert.equal(domainAgeDays({ events: [{ eventAction: 'registration', eventDate: '2026-10-29T00:00:00Z' }] }, new Date('2026-11-05T00:00:00Z')), 7);
  assert.equal(domainAgeDays({}), null);
});

// ---------- The whole handler, with stubs ----------
function kvStub() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, m };
}
const ENV = { ALLOWED_ORIGIN: 'https://app.example', PER_IP_DAILY: '2', DAILY_BROWSER_SECONDS: '30', SALT: 's' };
const post = (body, origin = 'https://app.example', ip = '203.0.113.9') => new Request('https://checker.example/check', {
  method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body),
});

function deps(over = {}) {
  const dns = { 'scam.example': ['93.184.216.34'] };
  const { fetchFn, seen } = net({ dns, pages: {
    'https://scam.example/kyc': { status: 200, headers: { 'content-type': 'text/html' } },
    'https://rdap.org/domain/scam.example': { events: [{ eventAction: 'registration', eventDate: '2026-11-01T00:00:00Z' }] },
  } });
  let t = Date.parse('2026-11-05T10:00:00Z');
  const browsed = [];
  return {
    seen, browsed,
    deps: {
      fetch: fetchFn,
      kv: kvStub(),
      now: () => new Date((t += 4000)),
      topSites: null,
      browse: async (url, allow) => {
        browsed.push(url);
        return { url, screenshot: 'BASE64JPEG', forms: [{ action: '', fields: [{ type: 'text', name: 'otp' }] }], private: await allow('http://127.0.0.1/x'), public: await allow('https://scam.example/app.js') };
      },
      ...over,
    },
  };
}

test('handler: only the app origin may ask; the URL is stripped again; signals and screenshot come back', async () => {
  const d = deps();
  assert.equal((await handle(post({ url: 'https://scam.example/kyc' }, 'https://evil.example'), ENV, d.deps)).status, 403);
  const res = await handle(post({ url: 'https://scam.example/kyc?phone=9123456780#x' }), ENV, d.deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.example');
  const body = await res.json();
  assert.equal(body.finalUrl, 'https://scam.example/kyc');
  assert.deepEqual(body.chain, ['https://scam.example/kyc']);
  assert.ok(body.signals.includes('otpForm') && body.signals.includes('youngDomain'));
  assert.equal(body.screenshot, 'BASE64JPEG');
  assert.ok(!d.seen.some((u) => u.includes('9123456780')), 'the query string never reaches the network');
  const preflight = await handle(new Request('https://checker.example/check', { method: 'OPTIONS', headers: { origin: 'https://app.example' } }), ENV, d.deps);
  assert.equal(preflight.status, 204);
});

test('handler: page requests to private addresses are refused inside the browser too', async () => {
  const d = deps({ browse: async (url, allow) => ({ url, forms: [], screenshot: null, flags: [await allow('http://127.0.0.1/'), await allow('http://169.254.169.254/'), await allow('https://scam.example/x.js'), await allow('file:///etc/passwd')] }) });
  let flags;
  d.deps.browse = async (url, allow) => { flags = [await allow('http://127.0.0.1/'), await allow('http://169.254.169.254/'), await allow('https://scam.example/x.js'), await allow('file:///etc/passwd')]; return { url, forms: [], screenshot: null }; };
  await handle(post({ url: 'https://scam.example/kyc' }), ENV, d.deps);
  assert.deepEqual(flags, [false, false, true, false]);
});

test('handler: per-visitor limit, daily browser budget, bad input, blocked targets, and no KV means not configured', async () => {
  const d = deps();
  assert.equal((await handle(post({ url: 'https://scam.example/kyc' }), ENV, d.deps)).status, 200);
  assert.equal((await handle(post({ url: 'https://scam.example/kyc' }), ENV, d.deps)).status, 200);
  assert.equal((await handle(post({ url: 'https://scam.example/kyc' }), ENV, d.deps)).status, 429, 'third check from the same visitor today');
  assert.ok(![...d.deps.kv.m.keys()].some((k) => k.includes('203.0.113.9')), 'the IP itself is never stored');

  const tight = deps();
  await tight.deps.kv.put('browser:2026-11-05', '30');
  assert.equal((await handle(post({ url: 'https://scam.example/kyc' }, undefined, '198.51.100.1'), ENV, tight.deps)).status, 429, 'daily browser budget spent');

  const fresh = deps();
  assert.equal((await handle(post({ url: 'javascript:alert(1)' }), ENV, fresh.deps)).status, 400);
  assert.equal((await handle(post({ url: 'http://10.0.0.1/' }), ENV, fresh.deps)).status, 403);
  assert.equal((await handle(post({ url: 'https://scam.example/kyc' }), ENV, { ...fresh.deps, kv: undefined })).status, 503);
});

test('handler: when the page will not render, the redirect chain and domain facts still come back', async () => {
  const d = deps({ browse: async () => { throw new Error('browser busy'); } });
  const body = await (await handle(post({ url: 'https://scam.example/kyc' }), ENV, d.deps)).json();
  assert.deepEqual(body.chain, ['https://scam.example/kyc']);
  assert.equal(body.screenshot, null);
  assert.ok(body.signals.includes('youngDomain'));
});

test('limits: IPv6 visitors are counted per /64, so a new address in the same block does not reset them', async () => {
  const d = deps();
  const ok1 = await handle(post({ url: 'https://scam.example/kyc' }, undefined, '2401:4900:1c2a:5b00::1'), ENV, d.deps);
  const ok2 = await handle(post({ url: 'https://scam.example/kyc' }, undefined, '2401:4900:1c2a:5b00::2'), ENV, d.deps);
  const third = await handle(post({ url: 'https://scam.example/kyc' }, undefined, '2401:4900:1c2a:5b00:ffff::9'), ENV, d.deps);
  assert.deepEqual([ok1.status, ok2.status, third.status], [200, 200, 429]);
  const other = await handle(post({ url: 'https://scam.example/kyc' }, undefined, '2401:4900:1c2a:5b01::1'), ENV, d.deps);
  assert.equal(other.status, 200, 'another /64 is another visitor');
});

test('a page that hangs is cut off and still charged to the daily browser budget', async () => {
  const d = deps({ browse: () => new Promise(() => {}) });
  const env = { ...ENV, BROWSE_SECONDS: '1', DAILY_BROWSER_SECONDS: '100' };
  const res = await handle(post({ url: 'https://scam.example/kyc' }), env, d.deps);
  assert.equal(res.status, 200, 'the chain and domain facts still come back');
  assert.equal((await res.json()).screenshot, null);
  assert.ok(Number(await d.deps.kv.get('browser:2026-11-05')) >= 1, 'the reserved second was charged');
});

test('page requests: only http(s) on the allowed ports, and one DNS check per host', async () => {
  const d = deps();
  let flags;
  d.deps.browse = async (url, allow) => {
    flags = await Promise.all(['https://scam.example:6379/', 'ws://scam.example/', 'https://scam.example/a.js', 'https://scam.example/b.js', 'data:image/png;base64,AA'].map(allow));
    return { url, forms: [], screenshot: null };
  };
  await handle(post({ url: 'https://scam.example/kyc' }), ENV, d.deps);
  assert.deepEqual(flags, [false, false, true, true, true]);
  assert.equal(d.seen.filter((u) => u.includes('cloudflare-dns.com') && u.includes('scam.example')).length, 2, 'A and AAAA once, shared by the chain and every page request');
});

test('a KV store that fails refuses checks rather than crashing or running without limits', async () => {
  const d = deps();
  d.deps.kv = { get: async () => { throw new Error('kv down'); }, put: async () => { throw new Error('kv down'); } };
  assert.equal((await handle(post({ url: 'https://scam.example/kyc' }), ENV, d.deps)).status, 429);
});

