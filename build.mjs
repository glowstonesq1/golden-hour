// Builds the static site into an output folder (default: dist).
// No dependencies: pages are generated from src/strings/*.json so the 1930 button
// and all guidance work with JavaScript disabled.
import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BANKS } from './static/proof-core.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const SOURCE_URL = 'https://github.com/glowstonesq1/golden-hour';
export const LANGS = { en: '/', hi: '/hi/', mr: '/mr/' };
export const PAGES = ['', 'help/', 'check/', 'report/', 'case/', 'terms/', 'privacy/'];

// Content-Security-Policy shared by vercel.json (header) and the meta tag (for hosts without headers).
// frame-ancestors only works as a header, so the meta copy leaves it out.
// 'wasm-unsafe-eval' lets the on-device OCR (vendored Tesseract.js) compile its WebAssembly. It allows
// compiling WebAssembly only: JavaScript eval and new Function stay blocked, and scripts stay 'self'.
export const CSP_META =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; font-src 'self'; " +
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

// Only what report.js writes at run time; everything else is already in the markup.
function journeyStrings(s, banks) {
  const r = s.report;
  const h = s.help;
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  return {
    ...pick(r, ['mic', 'micStop', 'micListening', 'micLocal', 'micDownloading', 'micDenied', 'micNetwork', 'micError',
      'consentTitle', 'consentBody', 'consentYes', 'consentNo', 'needStory', 'copied', 'copyFail', 'doc']),
    ...pick(h, ['ready', 'readAloud', 'ackSaved', 'ackInvalid', 'done', 'undone', 'caseCleared', 'ocrLoading', 'ocrReading',
      'ocrFailed', 'ocrSlow', 'zipFailed', 'noneFound', 'kinds', 'fromLine', 'correct', 'wrong', 'edit', 'saveEdit',
      'confirmed', 'leftOut', 'totalLine']),
    steps: Object.fromEntries(h.steps.map((st) => [st.id, st.title])),
    portal: pick(s.portal, ['stageN', 'copy', 'copied', 'notYet', 'evidenceReady', 'evidenceFail', 'ackPortal', 'ackCall', 'ackOther']),
    bank: pick(s.bank, ['listed', 'notListed', 'copied', 'refSaved', 'refInvalid', 'email']),
    mrm: pick(s.mrm, ['yourAck', 'idSaved', 'idInvalid']),
    banks,
  };
}

function stepExtra(s, p, id) {
  const r = s.report;
  const h = s.help;
  if (id === 'call') {
    return `
        <div class="js-only" hidden>
          <section class="ready" aria-labelledby="ready-title">
            <h3 id="ready-title">${esc(h.readyTitle)}</h3>
            <p id="ready-empty" class="hint">${esc(h.readyEmpty)}</p>
            <dl id="ready-list"></dl>
            <button type="button" id="read-aloud" class="secondary" hidden>${esc(h.readAloud)}</button>
          </section>
          <label for="ack">${esc(h.ackLabel)}</label>
          <div class="inline-field"><input id="ack" type="text" inputmode="numeric" autocomplete="off" maxlength="14" spellcheck="false">
          <button type="button" id="ack-save" class="secondary">${esc(h.ackSave)}</button></div>
          <p id="ack-status" class="status" role="status" aria-live="polite"></p>
        </div>`;
  }
  if (id === 'proof') {
    return `
        <div class="js-only" hidden>
          <p class="hint" id="proof-hint">${esc(h.proofHint)}</p>
          <label for="files" class="file-pick primary">${esc(h.proofChoose)}</label>
          <input id="files" class="visually-hidden" type="file" accept="image/*,.txt,.zip,text/plain,application/zip" multiple aria-describedby="proof-hint">
          <p id="ocr-status" class="status" role="status" aria-live="polite"></p>
          <details id="paste">
            <summary>${esc(h.pasteToggle)}</summary>
            <label for="sms">${esc(r.smsLabel)}</label>
            <p class="hint" id="sms-hint">${esc(r.smsHint)}</p>
            <textarea id="sms" rows="5" aria-describedby="sms-hint" spellcheck="false"></textarea>
            <button type="button" id="find" class="secondary">${esc(h.find)}</button>
          </details>
          <section id="review" class="review reveal" hidden aria-labelledby="review-title">
            <h3 id="review-title" tabindex="-1">${esc(h.cardsTitle)}</h3>
            <p class="hint">${esc(h.cardsHint)}</p>
            <div id="cards"></div>
            <p id="total-line" class="total-line"></p>
          </section>
        </div>`;
  }
  if (id === 'bank') {
    const b = s.bank;
    const names = BANKS.map(([name]) => `<option>${esc(name)}</option>`).join('');
    return `
        <div class="js-only" hidden>
          <div class="field"><label for="bank-pick">${esc(b.pick)}</label><select id="bank-pick"><option value="">${esc(b.other)}</option>${names}</select></div>
          <p id="bank-contact" class="hint"></p>
          <p class="hint">${esc(b.liability)}</p>
          <div class="actions">
            <a id="bank-write" class="primary" href="mailto:">${esc(b.write)}</a>
            <button type="button" id="bank-copy" class="secondary">${esc(b.copy)}</button>
          </div>
          <p id="bank-status" class="status" role="status" aria-live="polite"></p>
          <label for="bank-ref">${esc(b.refLabel)}</label>
          <div class="inline-field"><input id="bank-ref" type="text" autocomplete="off" maxlength="30" spellcheck="false">
          <button type="button" id="bank-ref-save" class="secondary">${esc(b.refSave)}</button></div>
          <p id="bank-ref-status" class="status" role="status" aria-live="polite"></p>
        </div>`;
  }
  if (id === 'claim') {
    const m = s.mrm;
    const list = (items) => items.map((x) => `<li>${esc(x)}</li>`).join('');
    return `
        <aside class="warn" role="note"><p>${esc(m.warn)}</p></aside>
        <section class="mrm" aria-labelledby="mrm-title">
          <h3 id="mrm-title">${esc(m.title)}</h3>
          <p class="src">${esc(m.checked)}</p>
          <ol class="mrm-steps">${list(m.steps)}</ol>
          <h4>${esc(m.readyTitle)}</h4>
          <ul class="mrm-ready"><li>${esc(m.ready[0])} <span id="mrm-ack" class="mrm-ack"></span></li>${list(m.ready.slice(1))}</ul>
          <p>${esc(m.fir)}</p>
          <h4>${esc(m.timelineTitle)}</h4>
          <ul>${list(m.timeline)}</ul>
          <p>${esc(m.hold)}</p>
          <p>${ext('https://mrm-ncrp.mha.gov.in/', m.open)}</p>
          <div class="js-only" hidden>
            <label for="mrm-id">${esc(m.idLabel)}</label>
            <div class="inline-field"><input id="mrm-id" type="text" autocomplete="off" maxlength="32" spellcheck="false" autocapitalize="characters">
            <button type="button" id="mrm-save" class="secondary">${esc(m.idSave)}</button></div>
            <p id="mrm-status" class="status" role="status" aria-live="polite"></p>
          </div>
        </section>`;
  }
  if (id === 'portal') {
    const w = s.portal;
    // Values each stage offers to copy (filled by portal.js from the case); evidence and ack get their own tools.
    const extra = [
      '', '', '<div class="stage-values" data-values="when,amount,utrs,bank"></div>', '<div class="stage-values" data-values="scammer"></div>', '',
      `<div class="js-only" hidden><label for="evidence" class="file-pick secondary">${esc(w.evidenceChoose)}</label>
            <input id="evidence" class="visually-hidden" type="file" accept="image/*" multiple>
            <ul id="evidence-list" class="evidence-list"></ul></div>`,
      `<div class="js-only" hidden><label for="portal-ack">${esc(h.ackLabel)}</label>
            <div class="inline-field"><input id="portal-ack" type="text" inputmode="numeric" autocomplete="off" maxlength="17" spellcheck="false">
            <button type="button" id="portal-ack-save" class="secondary">${esc(h.ackSave)}</button></div>
            <p id="portal-ack-status" class="status" role="status" aria-live="polite"></p></div>`,
    ];
    const stages = w.stages.map((st, i) => `
            <li class="stage" data-stage="${i}">
              <h4>${esc(st.title)}</h4>
              <p>${esc(st.body)}</p>
              ${extra[i]}
            </li>`).join('');
    return `
        <p class="portal">${ext(h.portalLink, 'cybercrime.gov.in')}</p>
        <section id="walk" class="walk" aria-labelledby="walk-title">
          <h3 id="walk-title">${esc(w.walk)}</h3>
          <p class="src">${esc(w.checked)}</p>
          <ol id="stages" class="stages" role="list">${stages}
          </ol>
          <div class="stage-nav js-only" hidden>
            <button type="button" id="stage-back" class="secondary">${esc(w.back)}</button>
            <span id="stage-count" class="stage-count" aria-live="polite"></span>
            <button type="button" id="stage-next" class="primary">${esc(w.next)}</button>
          </div>
          <p id="walk-status" class="status" role="status" aria-live="polite"></p>
          <p>${ext(h.portalLink, w.open)}</p>
        </section>`;
  }
  return '';
}

function journeyPage(s, p, banks) {
  const r = s.report;
  const h = s.help;
  const types = Object.entries(s.check.types).filter(([k]) => k !== 'unknown').map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
  const channels = Object.entries(r.channels).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const recipients = Object.entries(r.recipients)
    .map(([k, v], i) => `<label class="choice"><input type="radio" name="recipient" value="${k}"${i ? '' : ' checked'}> <span>${esc(v)}</span></label>`).join('');
  const steps = h.steps.map((st) => `
      <li id="step-${st.id}" class="jstep" data-step="${st.id}">
        <h2>${esc(st.title)}</h2>
        <p>${esc(st.body)}</p>${st.source ? `\n        <p class="src">${ext(st.source, s.sourceLabel)}</p>` : ''}${stepExtra(s, p, st.id)}
        <button type="button" class="done-btn" data-done="${st.id}" aria-pressed="false" hidden>${esc(h.done)}</button>
      </li>`).join('');
  return `${callButton(s)}
    <h1>${esc(h.title)}</h1>
    <p class="lead">${esc(h.lead)}</p>
    <ol class="steps journey" role="list">${steps}
    </ol>
    <section id="letter" class="letter" aria-labelledby="letter-title">
      <h2 id="letter-title">${esc(h.letterTitle)}</h2>
      <p class="hint">${esc(h.letterBody)}</p>
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
          <p id="mic-interim" class="hint interim"></p>
        </fieldset>
        <fieldset class="grid-2">
          <legend>${esc(r.youTitle)}</legend>
          ${field('name', r.name, 'text', 'autocomplete="name"')}
          ${field('mobile', r.mobile, 'tel', 'autocomplete="tel" inputmode="tel"')}
          ${field('email', r.email, 'email', 'autocomplete="email"')}
          ${field('address', r.address, 'text', 'autocomplete="address-level2"')}
          ${field('first-contact', r.firstContact, 'date')}
          <div class="field"><label for="channel">${esc(r.channel)}</label><select id="channel"><option value="">${esc(r.channelPick)}</option>${channels}</select></div>
          <div class="field"><label for="fraud-type">${esc(r.doc.fraudType)}</label><select id="fraud-type"><option value="">${esc(r.channelPick)}</option>${types}</select></div>
        </fieldset>
        <div class="field"><label for="contacts">${esc(r.contactsLabel)}</label><textarea id="contacts" rows="3" spellcheck="false"></textarea></div>
        <fieldset>
          <legend>${esc(r.recipient)}</legend>
          <div class="choices">${recipients}</div>
        </fieldset>
        <button type="submit" class="primary">${esc(r.make)}</button>
        <p id="form-status" class="status" role="status" aria-live="polite"></p>
      </form>
      <section id="preview" class="preview reveal" hidden aria-labelledby="preview-title">
        <h3 id="preview-title">${esc(r.previewTitle)}</h3>
        <article id="doc" class="doc"></article>
        <div class="actions">
          <button type="button" id="print" class="primary">${esc(r.print)}</button>
          <button type="button" id="copy" class="secondary">${esc(r.copy)}</button>
          <button type="button" id="share" class="secondary">${esc(r.share)}</button>
        </div>
        <p id="doc-status" class="status" role="status" aria-live="polite"></p>
      </section>
    </section>
    <aside class="note">
      <h2>${esc(h.noLossTitle)}</h2>
      <p>${esc(h.noLossBody)}</p>
      <p>${ext(h.noLossLink, 'sancharsaathi.gov.in')}</p>
    </aside>
    <div class="js-only" hidden>
      <button type="button" id="clear" class="text-button">${esc(h.clearCase)}</button>
      <p id="clear-status" class="status" role="status" aria-live="polite"></p>
    </div>
    <div id="report-strings" hidden data-t="${esc(JSON.stringify(journeyStrings(s, banks)))}"></div>`;
}

// Old addresses (report/, case/) are plain pages that forward to the journey, so they work offline,
// without JavaScript, and still show the 1930 button first.
const MOVED = { 'report/': 'help/#letter', 'case/': 'help/' };
const movedPage = (s, p, page) => `${callButton(s)}
    <h1>${esc(s.moved.title)}</h1>
    <p>${esc(s.moved.body)}</p>
    <p><a class="secondary" href="${p}${MOVED[page]}">${esc(s.moved.link)}</a></p>`;

function body(s, lang, page, banks) {
  const p = LANGS[lang];
  if (page === '') {
    const steps = Object.fromEntries(s.help.steps.map((st) => [st.id, st.title]));
    return `
    <section class="hero">
      <div class="hero-main">${callButton(s)}
        <h1 class="hero-title">${esc(s.home.lead)}</h1>
        <p class="trust">${icon('shield')}<span>${esc(s.home.trust)}</span></p>
        <div id="install" class="install" hidden>
          <button type="button" id="install-btn" class="secondary">${esc(s.install.button)}</button>
          <div id="install-help" class="install-help" hidden>
            <p>${esc(s.install.ios)}</p>
            <p>${esc(s.install.other)}</p>
          </div>
        </div>
      </div>
      <div class="doors">
        <a class="door door-primary" href="${p}help/">
          <span class="door-icon">${icon('wallet')}</span>
          <span class="door-text"><span class="door-title">${esc(s.home.helpTitle)}</span><span class="door-sub" id="help-sub" data-next="${esc(s.home.helpNext)}" data-steps="${esc(JSON.stringify(steps))}">${esc(s.home.helpSub)}</span></span>
          ${icon('arrow', 'ico door-arrow')}
        </a>${door(`${p}check/`, 'shield', s.home.checkTitle, s.home.checkSub)}
      </div>
    </section>`;
  }
  if (page === 'help/') return journeyPage(s, p, banks);
  if (MOVED[page]) return movedPage(s, p, page);
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
  const t = { 'help/': s.help.title, 'check/': s.check.title, 'report/': s.moved.title, 'case/': s.moved.title, 'terms/': s.terms.title, 'privacy/': s.privacy.title }[page];
  return `${t} | ${s.siteName}`;
}

export function renderPage(strings, lang, page, banks = []) {
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
  <link rel="stylesheet" href="/style.css">${MOVED[page] ? `
  <meta http-equiv="refresh" content="0; url=${p}${MOVED[page]}">` : ''}
</head>
<body class="page-${page.replace('/', '') || 'home'}">
  <div class="top-wrap"><header class="top">
    <a class="brand" href="${p}"><span class="brand-mark" aria-hidden="true"></span>${esc(s.siteName)}</a>
    <nav class="langs" aria-label="${esc(s.langLabel)}">${langLinks}</nav>
  </header></div>
  <main>${body(s, lang, page, banks)}
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
    // Files (screenshots, a WhatsApp chat export) are passed to the page in memory, never stored.
    share_target: {
      action: `${p}share-target/`,
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'files', accept: ['image/*', 'text/plain', 'application/zip', '.txt', '.zip'] }],
      },
    },
  };
}

export async function loadBanks() {
  return validateBanks(JSON.parse(await readFile(join(ROOT, 'data/banks.json'), 'utf8')).banks, BANKS.map(([name]) => name));
}

export async function loadStrings() {
  const out = {};
  for (const lang of Object.keys(LANGS)) {
    out[lang] = JSON.parse(await readFile(join(ROOT, 'src/strings', `${lang}.json`), 'utf8'));
  }
  return out;
}

export const isOcrFile = (f) => f.startsWith('/vendor/') || f === '/ocr.js';

// data/banks.json: every entry must name a known bank, give an email or phone, and cite a page on the
// bank's own domain (or rbi.org.in) with the date it was checked. The build stops on any bad entry.
export function validateBanks(list, names, today = new Date().toISOString().slice(0, 10)) {
  for (const b of list) {
    const where = b?.name || JSON.stringify(b);
    if (!names.includes(b.name)) throw new Error(`banks.json: unknown bank name: ${where}`);
    if (!Array.isArray(b.domains) || !b.domains.length) throw new Error(`banks.json: no domains for ${where}`);
    if (!b.email && !b.phone) throw new Error(`banks.json: no email or phone for ${where}`);
    if (b.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(b.email)) throw new Error(`banks.json: bad email for ${where}`);
    if (b.phone && !/^\+?[\d ]{8,16}$/.test(b.phone)) throw new Error(`banks.json: bad phone for ${where}`);
    let host = '';
    try {
      const u = new URL(b.source);
      if (u.protocol === 'https:') host = u.hostname;
    } catch {
      // handled below
    }
    const allowed = [...b.domains, 'rbi.org.in'];
    if (!host || !allowed.some((d) => host === d || host.endsWith(`.${d}`))) throw new Error(`banks.json: source is not https on the bank's own domain or rbi.org.in: ${where}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.checked || '') || b.checked > today) throw new Error(`banks.json: bad checked date for ${where}`);
  }
  return list;
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
  const banks = await loadBanks();
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(join(ROOT, 'static'), outDir, { recursive: true });
  await rm(join(outDir, 'sw.js'));

  for (const lang of Object.keys(LANGS)) {
    const p = LANGS[lang];
    for (const page of PAGES) {
      const dir = join(outDir, p, page);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'index.html'), renderPage(strings, lang, page, banks));
    }
    await writeFile(join(outDir, p, 'manifest.webmanifest'), JSON.stringify(manifest(strings, lang), null, 2));
  }

  // Precache everything built so the app works offline; the hash changes the worker on every content change.
  // OCR is left out (the engine and language data in /vendor/, about 16 MB, and the /ocr.js glue): it is fetched
  // only when someone first reads a screenshot, then kept by the worker's runtime cache.
  const files = (await listFiles(outDir)).sort();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(await readFile(join(outDir, f)));
  // The two 512 px icons are only fetched by the browser when the app is installed (online), never shown
  // by a page, so they stay out too: about a sixth of the offline copy.
  const installOnly = new Set(['/icons/icon-512.png', '/icons/icon-maskable-512.png']);
  const precache = files.filter((f) => !isOcrFile(f) && !installOnly.has(f)).map((f) => f.replace(/index\.html$/, ''));
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
