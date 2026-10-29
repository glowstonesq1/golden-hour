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
  return { caches, stores, fetched, lifecycle, dispatch };
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
const shared = async (w) => (await (await w.caches.open('gh-share')).match('/__shared__'))?.text();

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
    assert.equal(await shared(w), undefined, path);
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

test('activating removes old versions but keeps the current cache and pending shares', async () => {
  const w = loadWorker();
  await w.caches.open('gh-oldversion');
  await w.caches.open('gh-share');
  await w.lifecycle('install');
  await w.lifecycle('activate');
  const keys = await w.caches.keys();
  assert.ok(!keys.includes('gh-oldversion'));
  assert.ok(keys.includes('gh-share'));
  assert.equal(keys.filter((k) => k.startsWith('gh-') && k !== 'gh-share').length, 1);
});

test('requests to other sites are left alone', async () => {
  const w = loadWorker();
  assert.equal(await w.dispatch({ url: 'https://cybercrime.gov.in/', method: 'GET', mode: 'navigate' }), null);
});
