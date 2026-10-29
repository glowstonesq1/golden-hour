// Builds the static site into an output folder (default: dist).
// No dependencies: pages are generated from src/strings/*.json so the 1930 button
// and all guidance work with JavaScript disabled.
import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const SOURCE_URL = 'https://github.com/kaifq1/golden-hour';
export const LANGS = { en: '/', hi: '/hi/', mr: '/mr/' };
export const PAGES = ['', 'help/', 'check/', 'terms/', 'privacy/'];

// Content-Security-Policy shared by vercel.json (header) and the meta tag (for hosts without headers).
// frame-ancestors only works as a header, so the meta copy leaves it out.
export const CSP_META =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
  "connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function ext(href, text) {
  if (!/^https:\/\/[^/]/.test(href)) throw new Error(`External links must be https: ${href}`);
  return `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${esc(text)}</a>`;
}

const mtNote = (s) => (s.mtNote ? `\n    <p class="mt">${esc(s.mtNote)}</p>` : '');

// The machine-translation notice sits below the button so nothing comes before 1930.
const callButton = (s) => `
    <a class="call" href="tel:1930">
      <span class="call-label">${esc(s.call.label)}</span>
      <span class="call-sub">${esc(s.call.sub)}</span>
    </a>${mtNote(s)}`;

function body(s, lang, page) {
  const p = LANGS[lang];
  if (page === '') {
    return `${callButton(s)}
    <h1 class="lead">${esc(s.home.lead)}</h1>
    <div class="doors">
      <a class="door" href="${p}help/"><span class="door-title">${esc(s.home.helpTitle)}</span><span class="door-sub">${esc(s.home.helpSub)}</span></a>
      <a class="door" href="${p}check/"><span class="door-title">${esc(s.home.checkTitle)}</span><span class="door-sub">${esc(s.home.checkSub)}</span></a>
    </div>`;
  }
  if (page === 'help/') {
    const steps = s.help.steps
      .map((st) => `
      <li>
        <h2>${esc(st.title)}</h2>
        <p>${esc(st.body)}</p>${st.source ? `\n        <p class="src">${ext(st.source, s.sourceLabel)}</p>` : ''}
      </li>`)
      .join('');
    return `${callButton(s)}
    <h1>${esc(s.help.title)}</h1>
    <p class="lead">${esc(s.help.lead)}</p>
    <ol class="steps" role="list">${steps}
    </ol>
    <p class="portal">${ext(s.help.portalLink, 'cybercrime.gov.in')}</p>
    <aside class="note">
      <h2>${esc(s.help.noLossTitle)}</h2>
      <p>${esc(s.help.noLossBody)}</p>
      <p>${ext(s.help.noLossLink, 'sancharsaathi.gov.in')}</p>
    </aside>`;
  }
  if (page === 'check/') {
    const signs = s.check.signs.map((x) => `<li>${esc(x)}</li>`).join('');
    return `${callButton(s)}
    <h1>${esc(s.check.title)}</h1>
    <label for="msg">${esc(s.check.label)}</label>
    <textarea id="msg" rows="6" autocomplete="off" spellcheck="false"></textarea>
    <p>${esc(s.check.soon)}</p>
    <ul class="signs">${signs}</ul>
    <div class="actions">
      <button type="button" id="ask" hidden>${esc(s.check.ask)}</button>
      <a class="secondary" href="${p}help/">${esc(s.check.paid)}</a>
    </div>
    <p id="status" class="status" role="status" aria-live="polite"></p>
    <div id="strings" hidden data-copied="${esc(s.check.copied)}" data-copy-fail="${esc(s.check.copyFail)}" data-empty="${esc(s.check.empty)}" data-intro="${esc(s.check.shareIntro)}"></div>`;
  }
  const doc = page === 'terms/' ? s.terms : s.privacy;
  return `${mtNote(s)}
    <h1>${esc(doc.title)}</h1>
    ${doc.body.map((x) => `<p>${esc(x)}</p>`).join('\n    ')}`;
}

function title(s, page) {
  if (page === '') return s.home.title;
  const t = { 'help/': s.help.title, 'check/': s.check.title, 'terms/': s.terms.title, 'privacy/': s.privacy.title }[page];
  return `${t} | ${s.siteName}`;
}

export function renderPage(strings, lang, page) {
  const s = strings[lang];
  const p = LANGS[lang];
  const langLinks = Object.keys(LANGS)
    .map((l) => l === lang
      ? `<span aria-current="true">${esc(strings[l].langName)}</span>`
      : `<a href="${LANGS[l]}${page}" hreflang="${l}" lang="${l}">${esc(strings[l].langName)}</a>`)
    .join(' ');
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${CSP_META}">
  <meta name="referrer" content="no-referrer">
  <meta name="theme-color" content="#1c1a17">
  <title>${esc(title(s, page))}</title>
  <meta name="description" content="${esc(s.home.lead)}">
  <link rel="manifest" href="${p}manifest.webmanifest">
  <link rel="icon" href="/icons/icon-192.png" type="image/png">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="top">
    <a class="brand" href="${p}">${esc(s.siteName)}</a>
    <nav class="langs" aria-label="${esc(s.langLabel)}">${langLinks}</nav>
  </header>
  <main>${body(s, lang, page)}
  </main>
  <footer>
    <p>${esc(s.footer.disclaimer)}</p>
    <p><a href="${p}terms/">${esc(s.footer.terms)}</a> · <a href="${p}privacy/">${esc(s.footer.privacy)}</a> · ${ext(SOURCE_URL, s.footer.source)}</p>
  </footer>
  <script type="module" src="/app.js"></script>
</body>
</html>
`;
}

export function manifest(strings, lang) {
  const s = strings[lang];
  const p = LANGS[lang];
  return {
    name: s.siteName,
    short_name: s.siteName,
    description: s.home.lead,
    lang,
    start_url: p,
    scope: p,
    display: 'standalone',
    background_color: '#faf7f2',
    theme_color: '#1c1a17',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // POST so a shared message never appears in a URL; the service worker answers it on the device.
    share_target: {
      action: `${p}share-target/`,
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { title: 'title', text: 'text', url: 'url' },
    },
  };
}

export async function loadStrings() {
  const out = {};
  for (const lang of Object.keys(LANGS)) {
    out[lang] = JSON.parse(await readFile(join(ROOT, 'src/strings', `${lang}.json`), 'utf8'));
  }
  return out;
}

async function listFiles(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(full.slice(base.length).split('\\').join('/'));
  }
  return out;
}

export async function build(outDir = join(ROOT, 'dist')) {
  const strings = await loadStrings();
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(join(ROOT, 'static'), outDir, { recursive: true });
  await rm(join(outDir, 'sw.js'));

  for (const lang of Object.keys(LANGS)) {
    const p = LANGS[lang];
    for (const page of PAGES) {
      const dir = join(outDir, p, page);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'index.html'), renderPage(strings, lang, page));
    }
    await writeFile(join(outDir, p, 'manifest.webmanifest'), JSON.stringify(manifest(strings, lang), null, 2));
  }

  // Precache everything built so the app works offline; the hash changes the worker on every content change.
  const files = (await listFiles(outDir)).sort();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(await readFile(join(outDir, f)));
  const precache = files.map((f) => f.replace(/index\.html$/, ''));
  const sw = (await readFile(join(ROOT, 'static/sw.js'), 'utf8'))
    .replace('__VERSION__', hash.digest('hex').slice(0, 12))
    .replace('__PRECACHE__', JSON.stringify(precache))
    .replace('__PREFIXES__', JSON.stringify(Object.values(LANGS)));
  await writeFile(join(outDir, 'sw.js'), sw);
  return { outDir, files: [...files, '/sw.js'] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { files } = await build(process.argv[2]);
  console.log(`Built ${files.length} files.`);
}
