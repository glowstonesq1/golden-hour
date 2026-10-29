// Checks the milestone 1 promises against the built output.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, esc, ext, LANGS, PAGES, CSP_META } from '../build.mjs';

let out;
const pages = [];
for (const lang of Object.keys(LANGS)) for (const page of PAGES) pages.push({ lang, page, path: `${LANGS[lang]}${page}index.html` });
const read = (p) => readFile(join(out, p), 'utf8');

before(async () => {
  out = await mkdtemp(join(tmpdir(), 'gh-build-'));
  await build(out);
});

test('the 1930 button comes before any script on every crisis page', async () => {
  for (const { lang, page, path } of pages) {
    if (page === 'terms/' || page === 'privacy/') continue;
    const html = await read(path);
    const call = html.indexOf('href="tel:1930"');
    assert.ok(call > 0, `${path} has no tel:1930 link`);
    assert.ok(call < html.indexOf('<script'), `${path} loads a script before the 1930 button`);
    assert.match(html, new RegExp(`<html lang="${lang}">`));
  }
});

test('no inline scripts, inline styles or event handler attributes (CSP stays strict)', async () => {
  for (const { path } of pages) {
    const html = await read(path);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, `${path} has an inline script`);
    assert.doesNotMatch(html, /<style/, `${path} has an inline style block`);
    assert.doesNotMatch(html, /\sstyle=/, `${path} has a style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${path} has an inline event handler`);
    assert.ok(html.includes(CSP_META), `${path} is missing the CSP meta tag`);
  }
});

test('external links open with noopener noreferrer', async () => {
  for (const { path } of pages) {
    const html = await read(path);
    for (const tag of html.match(/<a [^>]*href="https?:[^"]*"[^>]*>/g) || []) {
      assert.match(tag, /rel="noopener noreferrer"/, `${path}: ${tag}`);
    }
  }
});

test('every language has the same string keys', async () => {
  const shape = (o) => (Array.isArray(o) ? o.map(shape) : o && typeof o === 'object'
    ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, shape(o[k])])) : typeof o);
  const files = await Promise.all(Object.keys(LANGS).map((l) => readFile(new URL(`../src/strings/${l}.json`, import.meta.url), 'utf8')));
  const [first, ...rest] = files.map((f) => shape(JSON.parse(f)));
  for (const s of rest) assert.deepEqual(s, first);
});

test('machine-translated pages say so; English does not', async () => {
  assert.doesNotMatch(await read('index.html'), /class="mt"/);
  assert.match(await read('hi/index.html'), /class="mt"/);
  assert.match(await read('mr/index.html'), /class="mt"/);
});

test('each manifest is installable and shares by POST into its own language', async () => {
  for (const [lang, prefix] of Object.entries(LANGS)) {
    const m = JSON.parse(await read(`${prefix}manifest.webmanifest`));
    assert.equal(m.lang, lang);
    assert.equal(m.start_url, prefix);
    assert.equal(m.scope, prefix);
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some((i) => i.sizes === '192x192'));
    assert.ok(m.icons.some((i) => i.sizes === '512x512' && !i.purpose));
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
    for (const i of m.icons) await stat(join(out, i.src));
    assert.equal(m.share_target.method, 'POST');
    assert.equal(m.share_target.enctype, 'multipart/form-data');
    assert.equal(m.share_target.action, `${prefix}share-target/`);
  }
});

test('service worker precaches every page and asset', async () => {
  const sw = await read('sw.js');
  assert.doesNotMatch(sw, /__PRECACHE__|__VERSION__/);
  const precache = JSON.parse(sw.match(/const PRECACHE = (\[.*\]);/)[1]);
  for (const { lang, page } of pages) assert.ok(precache.includes(`${LANGS[lang]}${page}`), `missing ${LANGS[lang]}${page}`);
  for (const asset of ['/style.css', '/app.js', '/icons/icon-192.png', '/manifest.webmanifest']) assert.ok(precache.includes(asset), asset);
  assert.ok(!precache.includes('/sw.js'));
});

test('Vercel headers: strict CSP and no network destinations other than self', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const headers = Object.fromEntries(config.headers[0].headers.map((h) => [h.key, h.value]));
  const csp = headers['Content-Security-Policy'];
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /connect-src 'self';/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  assert.ok(csp.startsWith(CSP_META), 'meta CSP and header CSP drifted apart');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
});

// Measured as transfer size: hosts serve text compressed, and PNGs are already compressed.
test('first visit, including the whole offline precache, downloads under 150 KB', async () => {
  const sw = await read('sw.js');
  const precache = JSON.parse(sw.match(/const PRECACHE = (\[.*\]);/)[1]);
  const size = async (f) => {
    const buf = await readFile(join(out, f));
    return f.endsWith('.png') ? buf.length : gzipSync(buf, { level: 9 }).length;
  };
  let total = await size('sw.js');
  for (const f of precache) total += await size(f.endsWith('/') ? `${f}index.html` : f);
  assert.ok(total < 150 * 1024, `first visit downloads ${total} bytes`);
});

test('every page has exactly one h1, and the 1930 button comes before any notice', async () => {
  for (const { path } of pages) {
    const html = await read(path);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, path);
    const mt = html.indexOf('class="mt"');
    const call = html.indexOf('tel:1930');
    if (mt > 0 && call > 0) assert.ok(call < mt, `${path}: notice appears before the 1930 button`);
  }
});

test('external links must be https', () => {
  assert.throws(() => ext('javascript:alert(1)', 'x'));
  assert.throws(() => ext('http://example.com', 'x'));
  assert.match(ext('https://cybercrime.gov.in/', 'x'), /href="https:\/\/cybercrime\.gov\.in\/"/);
});

test('client code never builds HTML from strings or evaluates code', async () => {
  const dir = new URL('../static/', import.meta.url);
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.js'))) {
    const src = await readFile(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, f);
  }
});

test('esc escapes every HTML-significant character', () => {
  assert.equal(esc(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('the 1930 button meets WCAG AA contrast in light and dark themes', async () => {
  const css = await readFile(new URL('../static/style.css', import.meta.url), 'utf8');
  const lum = (hex) => {
    const [r, g, b] = hex.match(/\w\w/g).map((h) => parseInt(h, 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const call of css.match(/--call: (#[0-9a-f]{6})/g).map((m) => m.split(' ')[1])) {
    assert.ok(ratio(call, '#ffffff') >= 4.5, `${call} on white is ${ratio(call, '#ffffff').toFixed(2)}`);
  }
});
