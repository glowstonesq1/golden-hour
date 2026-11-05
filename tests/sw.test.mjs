// Runs the built service worker in a VM with fake caches, so share handling and offline rules are tested in npm test.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { build } from '../build.mjs';

const ORIGIN = 'https://app.test';
let source;

before(async () => {
  const out = await mkdtemp(join(tmpdir(), 'gh-sw-'));
  await build(out);
  source = await readFile(join(out, 'sw.js'), 'utf8');
});

class FakeResponse {
  constructor(body = '', init = {}) { this.body = body; this.status = init.status ?? 200; }
  async text() { return String(this.body ?? ''); }
  get ok() { return this.status >= 200 && this.status < 300; }
  clone() { return new FakeResponse(this.body, { status: this.status }); }
  static redirect(location, status) { return Object.assign(new FakeResponse(null, { status }), { location }); }
  static error() { return new FakeResponse(null, { status: 0 }); }
}

class FakeCache {
  constructor() { this.entries = new Map(); }
  key(r, ignoreSearch) { const u = new URL(typeof r === 'string' ? r : r.url, ORIGIN); return u.pathname + (ignoreSearch ? '' : u.search); }
  async put(r, res) { this.entries.set(this.key(r), res); }
  async match(r, opts = {}) {
    if (!opts.ignoreSearch) return this.entries.get(this.key(r));
    return [...this.entries].find(([k]) => k.split('?')[0] === this.key(r, true))?.[1];
  }
  async delete(r) { return this.entries.delete(this.key(r)); }
  async addAll(reqs) { for (const r of reqs) this.entries.set(this.key(r), new FakeResponse(`cached ${r.url}`)); }
}

function loadWorker({ online = true } = {}) {
  const clock = { now: 1_000_000, timers: [] };
  const handlers = {};
  const stores = new Map();
  const caches = {
    async open(name) { if (!stores.has(name)) stores.set(name, new FakeCache()); return stores.get(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const fetched = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const context = vm.createContext({
    self, caches, URL,
    Date: { now: () => clock.now },
    setTimeout: (fn, ms) => clock.timers.push({ fn, at: clock.now + ms }),
    Request: class { constructor(url, init) { this.url = url; Object.assign(this, init); } },
    Response: FakeResponse,
    fetch: async (r) => { fetched.push(r.url); if (!online) throw new TypeError('offline'); return new FakeResponse(`network ${r.url}`); },
  });
  vm.runInContext(source, context);

  async function lifecycle(type) {
    let done;
    handlers[type]({ waitUntil: (p) => { done = p; } });
    await done;
  }
  async function dispatch(request) {
    let response = null;
    handlers.fetch({ request, respondWith: (p) => { response = p; } });
    return response && (await response);
  }
  // A page asking for the pending share, as app.js does on every load.
  function take() {
    let reply;
    handlers.message({ data: { type: 'take-share' }, ports: [{ postMessage: (m) => { reply = m; } }] });
    return reply?.text;
  }
  // Moves the fake clock on and runs the timers that are due.
  function advance(ms) {
    clock.now += ms;
    for (const t of clock.timers.filter((x) => x.at <= clock.now)) t.fn();
    clock.timers = clock.timers.filter((x) => x.at > clock.now);
  }
  return { caches, stores, fetched, lifecycle, dispatch, take, handlers, advance };
}

const post = (path, fields, { broken = false } = {}) => ({
  url: ORIGIN + path,
  method: 'POST',
  mode: 'navigate',
  async formData() {
    if (broken) throw new TypeError('bad multipart');
    return new Map(Object.entries(fields));
  },
});
const get = (path, mode = 'navigate') => ({ url: ORIGIN + path, method: 'GET', mode });
const shared = async (w) => w.take();

test('a share to the English app lands on the English Check page, on the device', async () => {
  const w = loadWorker();
  const res = await w.dispatch(post('/share-target/', { title: 'SBI Alert', text: 'KYC expires today', url: '' }));
  assert.equal(res.status, 303);
  assert.equal(res.location, '/check/?shared=1');
  assert.equal(await shared(w), 'SBI Alert\nKYC expires today');
  assert.deepEqual(w.fetched, [], 'a share must never touch the network');
});

test('a share to the Hindi app lands on the Hindi Check page', async () => {
  const w = loadWorker();
  const res = await w.dispatch(post('/hi/share-target/', { text: 'hello' }));
  assert.equal(res.location, '/hi/check/?shared=1');
});

test('only the exact share paths are handled, so the worker cannot be used as a redirect', async () => {
  for (const path of ['//evil.com/share-target/', '/x/share-target/', '/hi/x/share-target/', '/share-target/extra']) {
    const w = loadWorker();
    assert.equal(await w.dispatch(post(path, { text: 'attack' })), null, path);
    assert.equal(await shared(w), '', path);
  }
});

test('a malformed share opens an empty Check page instead of failing', async () => {
  const w = loadWorker();
  const res = await w.dispatch(post('/mr/share-target/', {}, { broken: true }));
  assert.equal(res.location, '/mr/check/?shared=1');
  assert.equal(await shared(w), '');
});

test('very long shares are cut to 10,000 characters', async () => {
  const w = loadWorker();
  await w.dispatch(post('/share-target/', { text: 'a'.repeat(20000) }));
  assert.equal((await shared(w)).length, 10000);
});

test('offline, pages open from the cache even with tracking parameters', async () => {
  const w = loadWorker({ online: false });
  await w.lifecycle('install');
  const res = await w.dispatch(get('/help/?utm_source=whatsapp'));
  assert.match(await res.text(), /cached \/help\//);
});

test('offline, an unknown page falls back to that language home with the 1930 button', async () => {
  const w = loadWorker({ online: false });
  await w.lifecycle('install');
  assert.match(await (await w.dispatch(get('/hi/unknown'))).text(), /cached \/hi\/$/);
  assert.match(await (await w.dispatch(get('/help'))).text(), /cached \/$/);
});

test('a pending share is never served as a page', async () => {
  const w = loadWorker();
  await w.dispatch(post('/share-target/', { text: 'secret OTP 123456' }));
  const res = await w.dispatch(get('/__shared__', 'same-origin'));
  assert.doesNotMatch(await res.text(), /secret/);
});

test('activating removes old versions and the old share cache, keeping only the current cache', async () => {
  const w = loadWorker();
  await w.caches.open('gh-oldversion');
  await w.caches.open('gh-share');
  await w.lifecycle('install');
  await w.lifecycle('activate');
  const keys = await w.caches.keys();
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^gh-[0-9a-f]{12}$/);
});

test('shared files go to the proof step and are handed over in memory, never cached', async () => {
  const w = loadWorker();
  const shot = { name: 'receipt.png', size: 1234, type: 'image/png' };
  const res = await w.dispatch({ url: `${ORIGIN}/mr/share-target/`, method: 'POST', mode: 'navigate',
    async formData() { return { get: () => null, getAll: (k) => (k === 'files' ? [shot, { name: 'empty', size: 0 }] : []) }; } });
  assert.equal(res.location, '/mr/help/?shared=1#step-proof');
  assert.deepEqual(await w.caches.keys(), []);
  let reply;
  w.handlers.message({ data: { type: 'take-share' }, ports: [{ postMessage: (m) => { reply = m; } }] });
  assert.deepEqual(reply.files, [shot], 'empty files are dropped');
});

test('OCR files are cached on first use in their own cache, which survives a new version', async () => {
  const w = loadWorker();
  await w.lifecycle('install');
  await w.dispatch(get('/vendor/tessdata/eng.traineddata.gz', 'cors'));
  await w.caches.open('gh-oldversion');
  await w.lifecycle('activate');
  const keys = await w.caches.keys();
  assert.ok(keys.includes('gh-ocr-7.0.0') && !keys.includes('gh-oldversion'));
  assert.ok(await (await w.caches.open('gh-ocr-7.0.0')).match('/vendor/tessdata/eng.traineddata.gz'));
});

test('a share lives only in memory, is handed over once, and never touches Cache Storage', async () => {
  const w = loadWorker();
  await w.dispatch(post('/share-target/', { text: 'Your KYC expires' }));
  assert.deepEqual(await w.caches.keys(), [], 'nothing written to Cache Storage');
  assert.equal(w.take(), 'Your KYC expires');
  assert.equal(w.take(), '', 'a second page never sees it');
});

test('a share expires after two minutes, whether or not a page asks for it', async () => {
  const w = loadWorker();
  await w.dispatch(post('/share-target/', { text: 'Your KYC expires' }));
  w.advance(2 * 60 * 1000 + 1);
  assert.equal(w.take(), '', 'an old share is never handed over');
  await w.dispatch(post('/share-target/', { text: 'second' }));
  w.advance(60 * 1000);
  assert.equal(w.take(), 'second', 'a fresh share still is');
});

test('the OCR glue is served from the app cache, not the OCR cache', async () => {
  const w = loadWorker();
  await w.lifecycle('install');
  await w.dispatch(get('/ocr.js', 'cors'));
  assert.ok(!(await (await w.caches.open('gh-ocr-7.0.0')).match('/ocr.js')), '/ocr.js never lands in the cache that survives versions');
});

test('requests to other sites are left alone', async () => {
  const w = loadWorker();
  assert.equal(await w.dispatch({ url: 'https://cybercrime.gov.in/', method: 'GET', mode: 'navigate' }), null);
});
