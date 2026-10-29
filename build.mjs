// Builds the static site into an output folder (default: dist).
// No dependencies: pages are generated from src/strings/*.json so the 1930 button
// and all guidance work with JavaScript disabled.
import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const SOURCE_URL = 'https://github.com/glowstonesq1/golden-hour';
export const LANGS = { en: '/', hi: '/hi/', mr: '/mr/' };
export const PAGES = ['', 'help/', 'check/', 'report/', 'terms/', 'privacy/'];

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

// Inline SVG icons (decorative; the text next to them carries the meaning).
const ICONS = {
  phone: '<path d="M6.6 3.5h2.6l1.4 4-1.9 1.3a12 12 0 0 0 6.5 6.5l1.3-1.9 4 1.4v2.6a2 2 0 0 1-2.1 2A16.5 16.5 0 0 1 4.5 5.6a2 2 0 0 1 2.1-2.1Z"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><path d="M4 7.5v10A2.5 2.5 0 0 0 6.5 20H20V8H6.5A2.5 2.5 0 0 1 4 5.5"/><circle cx="16" cy="14" r="1.2"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
};
const icon = (name, cls = 'ico') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

// The machine-translation notice sits below the button so nothing comes before 1930.
const callButton = (s) => `
    <a class="call" href="tel:1930">
      <span class="call-icon">${icon('phone')}</span>
      <span class="call-text"><span class="call-label">${esc(s.call.label)}</span>
      <span class="call-sub">${esc(s.call.sub)}</span></span>
    </a>${mtNote(s)}`;

const door = (href, ic, title, sub) => `
        <a class="door" href="${href}">
          <span class="door-icon">${icon(ic)}</span>
          <span class="door-text"><span class="door-title">${esc(title)}</span><span class="door-sub">${esc(sub)}</span></span>
          ${icon('arrow', 'ico door-arrow')}
        </a>`;

const field = (id, label, type = 'text', extra = '') =>
  `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" ${extra}></div>`;

function reportPage(s, p) {
  const r = s.report;
  const channels = Object.entries(r.channels).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const recipients = Object.entries(r.recipients)
    .map(([k, v], i) => `<label class="choice"><input type="radio" name="recipient" value="${k}"${i ? '' : ' checked'}> <span>${esc(v)}</span></label>`).join('');
  const next = r.next.map((st) => `
        <li>
          <h3>${esc(st.title)}</h3>
          <p>${esc(st.body)}</p>${st.source ? `\n          <p class="src">${ext(st.source, s.sourceLabel)}</p>` : ''}
        </li>`).join('');
  // Only what report.js writes at run time; everything else is already in the markup.
  const pick = (keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));
  const strings = {
    ...pick(['mic', 'micStop', 'micListening', 'micLocal', 'micDownloading', 'micDenied', 'micNetwork', 'micError',
      'consentTitle', 'consentBody', 'consentYes', 'consentNo', 'needStory', 'noPayments', 'removePayment', 'paymentN',
      'aiWorking', 'aiDownloading', 'aiRejected', 'aiFailed', 'copied', 'copyFail', 'cleared', 'doc']),
    types: Object.fromEntries(Object.entries(s.check.types).map(([k, v]) => [k, v.name])),
  };
  return `${callButton(s)}
    <h1>${esc(r.title)}</h1>
    <p class="lead">${esc(r.lead)}</p>
    <p class="nojs" id="nojs">${esc(r.noJs)}</p>
    <form id="report-form" class="report-form" hidden novalidate>
      <fieldset>
        <legend>${esc(r.storyTitle)}</legend>
        <label for="story">${esc(r.storyLabel)}</label>
        <p class="hint" id="story-hint">${esc(r.storyHint)}</p>
        <textarea id="story" rows="8" aria-describedby="story-hint" spellcheck="false"></textarea>
        <div class="mic-row">
          <button type="button" id="mic" class="mic" hidden aria-pressed="false">${icon('mic')}<span id="mic-label">${esc(r.mic)}</span></button>
          <p id="mic-status" class="hint" role="status" aria-live="polite">${esc(r.micKeyboard)}</p>
        </div>
      </fieldset>
      <fieldset>
        <legend>${esc(r.smsTitle)}</legend>
        <label for="sms">${esc(r.smsLabel)}</label>
        <p class="hint" id="sms-hint">${esc(r.smsHint)}</p>
        <textarea id="sms" rows="5" aria-describedby="sms-hint" spellcheck="false"></textarea>
      </fieldset>
      <fieldset class="grid-2">
        <legend>${esc(r.youTitle)}</legend>
        ${field('name', r.name, 'text', 'autocomplete="name"')}
        ${field('mobile', r.mobile, 'tel', 'autocomplete="tel" inputmode="tel"')}
        ${field('email', r.email, 'email', 'autocomplete="email"')}
        ${field('address', r.address, 'text', 'autocomplete="address-level2"')}
      </fieldset>
      <fieldset class="grid-2">
        <legend>${esc(r.incidentTitle)}</legend>
        ${field('first-contact', r.firstContact, 'date')}
        <div class="field"><label for="channel">${esc(r.channel)}</label><select id="channel"><option value="">${esc(r.channelPick)}</option>${channels}</select></div>
        ${field('bank', r.bank)}
        ${field('ack', r.ack, 'text', 'inputmode="numeric"')}
      </fieldset>
      <fieldset>
        <legend>${esc(r.recipient)}</legend>
        <div class="choices">${recipients}</div>
      </fieldset>
      <button type="submit" class="primary">${esc(r.make)}</button>
      <p id="form-status" class="status" role="status" aria-live="polite"></p>
    </form>
    <section id="review" class="review reveal" hidden aria-labelledby="review-title">
      <h2 id="review-title" tabindex="-1">${esc(r.checkTitle)}</h2>
      <p class="hint">${esc(r.checkHint)}</p>
      <div id="payments"></div>
      <button type="button" id="add-payment" class="secondary">${esc(r.addPayment)}</button>
      <div class="field"><label for="contacts">${esc(r.contactsLabel)}</label><textarea id="contacts" rows="4" spellcheck="false"></textarea></div>
      <div id="ai" class="ai" hidden>
        <button type="button" id="ai-run" class="secondary">${esc(r.aiButton)}</button>
        <p id="ai-status" class="hint" role="status" aria-live="polite"></p>
        <div id="ai-result" hidden>
          <label for="ai-text">${esc(r.aiLabel)}</label>
          <textarea id="ai-text" rows="5"></textarea>
          <label class="choice"><input type="checkbox" id="ai-ok"> <span>${esc(r.aiConfirm)}</span></label>
          <p class="hint">${esc(r.aiNote)}</p>
        </div>
      </div>
    </section>
    <section id="preview" class="preview reveal" hidden aria-labelledby="preview-title">
      <h2 id="preview-title">${esc(r.previewTitle)}</h2>
      <article id="doc" class="doc"></article>
      <div class="actions">
        <button type="button" id="print" class="primary">${esc(r.print)}</button>
        <button type="button" id="copy" class="secondary">${esc(r.copy)}</button>
        <button type="button" id="share" class="secondary">${esc(r.share)}</button>
      </div>
      <p id="doc-status" class="status" role="status" aria-live="polite"></p>
      <button type="button" id="next-toggle" class="next-toggle" aria-expanded="false" aria-controls="next">${esc(r.nextButton)} ${icon('arrow')}</button>
      <section id="next" class="next reveal" hidden aria-labelledby="next-title">
        <h2 id="next-title">${esc(r.nextTitle)}</h2>
        <ol class="steps" role="list">${next}
        </ol>
        <p class="portal">${ext(s.help.portalLink, 'cybercrime.gov.in')}</p>
      </section>
      <button type="button" id="clear" class="text-button">${esc(r.clear)}</button>
    </section>
    <div id="report-strings" hidden data-t="${esc(JSON.stringify(strings))}"></div>`;
}

function body(s, lang, page) {
  const p = LANGS[lang];
  if (page === '') {
    return `
    <section class="hero">
      <div class="hero-main">${callButton(s)}
        <h1 class="hero-title">${esc(s.home.lead)}</h1>
        <p class="trust">${icon('shield')}<span>${esc(s.home.trust)}</span></p>
      </div>
      <div class="doors">${door(`${p}help/`, 'wallet', s.home.helpTitle, s.home.helpSub)}${door(`${p}check/`, 'shield', s.home.checkTitle, s.home.checkSub)}
      </div>
    </section>`;
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
    <a class="report-card" href="${p}report/">
      <span class="door-icon">${icon('doc')}</span>
      <span class="door-text"><span class="door-title">${esc(s.help.reportTitle)}</span><span class="door-sub">${esc(s.help.reportBody)}</span>
      <span class="report-cta">${esc(s.help.reportButton)} ${icon('arrow')}</span></span>
    </a>
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
  if (page === 'report/') return reportPage(s, p);
  if (page === 'check/') {
    const signs = s.check.signs.map((x) => `<li>${esc(x)}</li>`).join('');
    const labels = { intro: s.check.resultIntro, verdicts: s.check.verdicts, types: s.check.types, signNames: s.check.signNames };
    // The result is filled by app.js with textContent only; without JavaScript the static signs list stays.
    return `${callButton(s)}
    <h1>${esc(s.check.title)}</h1>
    <label for="msg">${esc(s.check.label)}</label>
    <textarea id="msg" rows="6" autocomplete="off" spellcheck="false"></textarea>
    <button type="button" id="run" class="run primary" hidden>${esc(s.check.run)}</button>
    <section id="result" class="result reveal" hidden tabindex="-1" aria-labelledby="verdict">
      <h2 id="verdict"></h2>
      <p id="verdict-body"></p>
      <p id="type" class="type"></p>
      <p id="rule" class="rule"></p>
      <h3 id="signs-title" hidden>${esc(s.check.signsTitle)}</h3>
      <ul id="found" class="signs"></ul>
      <p class="disclaimer">${esc(s.check.disclaimer)} <a href="${p}terms/">${esc(s.footer.terms)}</a></p>
    </section>
    <div id="fallback">
      <p>${esc(s.check.fallback)}</p>
      <ul class="signs">${signs}</ul>
    </div>
    <div class="actions">
      <button type="button" id="ask" class="primary" hidden>${esc(s.check.ask)}</button>
      <a class="secondary" href="${p}help/">${esc(s.check.paid)}</a>
    </div>
    <p id="status" class="status" role="status" aria-live="polite"></p>
    <div id="strings" hidden data-copied="${esc(s.check.copied)}" data-copy-fail="${esc(s.check.copyFail)}" data-empty="${esc(s.check.empty)}" data-intro="${esc(s.check.shareIntro)}" data-labels="${esc(JSON.stringify(labels))}"></div>`;
  }
  const doc = page === 'terms/' ? s.terms : s.privacy;
  return `${mtNote(s)}
    <h1>${esc(doc.title)}</h1>
    ${doc.body.map((x) => `<p>${esc(x)}</p>`).join('\n    ')}`;
}

function title(s, page) {
  if (page === '') return s.home.title;
  const t = { 'help/': s.help.title, 'check/': s.check.title, 'report/': s.report.title, 'terms/': s.terms.title, 'privacy/': s.privacy.title }[page];
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
<body class="page-${page.replace('/', '') || 'home'}">
  <div class="top-wrap"><header class="top">
    <a class="brand" href="${p}"><span class="brand-mark" aria-hidden="true"></span>${esc(s.siteName)}</a>
    <nav class="langs" aria-label="${esc(s.langLabel)}">${langLinks}</nav>
  </header></div>
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
