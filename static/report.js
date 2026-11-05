// The "I lost money" journey: the case on this phone, the call card, proof, and the complaint letter.
// Loaded by app.js only on the journey page. Builds DOM with textContent only, never from HTML strings.
// Only case-core's sanitized fields ever reach localStorage; names, numbers and the story stay in memory.
import { check } from './rules.js';
import { extractContacts, buildReport, reportText, amountValue } from './report-core.js';
import { CASE_KEY, parseCase, sanitize, markDone, nextStep, formatDate, formatAmount, toIso, ackInfo } from './case-core.js';
import { initPortal } from './portal.js';
import { findCards, zipTexts, parseWhatsApp, canonicalBank } from './proof-core.js';

const $ = (id) => document.getElementById(id);
const T = JSON.parse($('report-strings').dataset.t);
const LANG = document.documentElement.lang;
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
};
const val = (id) => $(id).value.trim();

const form = $('report-form');
const story = $('story');
let cards = []; // this visit only, in memory; the case keeps just what the person marked Correct
let base = {}; // the case as it was before these cards, so marking Wrong after Correct puts it back
let extractedFrom = { story: null }; // re-extract only text that changed, keeping corrections

for (const el of document.querySelectorAll('.js-only')) el.hidden = false;
$('nojs').hidden = true;
form.hidden = false;

// ---------- The case on this phone ----------
function loadCase() {
  try {
    return parseCase(localStorage.getItem(CASE_KEY) || '{}');
  } catch {
    return {}; // storage blocked (private window): the journey still works, it just forgets
  }
}
function saveCase(c) {
  kase = sanitize(c);
  try {
    if (Object.keys(kase).length) localStorage.setItem(CASE_KEY, JSON.stringify(kase));
    else localStorage.removeItem(CASE_KEY);
  } catch {
    // not saved, but the page keeps working for this visit
  }
  renderCase();
}
let kase = loadCase();
let portal = null; // set once the page is ready, below

function renderCase() {
  const next = nextStep(kase);
  for (const btn of document.querySelectorAll('[data-done]')) {
    const id = btn.dataset.done;
    const when = kase.done?.[id];
    btn.hidden = false;
    btn.setAttribute('aria-pressed', String(!!when));
    btn.textContent = when ? fill(T.undone, { date: formatDate(when, LANG) }) : T.done;
    btn.closest('li').classList.toggle('is-done', !!when);
    btn.closest('li').classList.toggle('is-next', id === next);
  }
  $('ack').value = kase.ack || $('ack').value;
  $('portal-ack').value = kase.ack || $('portal-ack').value;
  if (kase.bank && !val('bank')) $('bank').value = kase.bank;
  $('total-line').textContent = kase.amount ? fill(T.totalLine, { amount: formatAmount(kase.amount) }) : '';
  renderReady();
}

for (const btn of document.querySelectorAll('[data-done]')) {
  btn.addEventListener('click', () => saveCase(markDone(kase, btn.dataset.done, !kase.done?.[btn.dataset.done])));
}

// ---------- Step 1: what to have ready for the 1930 call ----------
// Who was paid and the scammer's numbers, from cards marked Correct: shown and used in the letter, never stored.
const scammerIds = () => [...new Set(cards.filter((c) => c.state === 'ok' && (c.kind === 'scammer' || (c.kind === 'payee' && /@/.test(c.value)))).map((c) => c.value))];

function readyItems() {
  return [
    ['amount', kase.amount && formatAmount(kase.amount)],
    ['when', kase.lossAt && formatDate(kase.lossAt, LANG)],
    ['utrs', kase.utrs?.join(', ')],
    ['bank', kase.bank],
    ['scammer', scammerIds().join(', ')], // from this visit only: never stored
  ].filter(([, v]) => v);
}

function renderReady() {
  const items = readyItems();
  $('ready-list').replaceChildren(...items.flatMap(([k, v]) => [h('dt', { textContent: T.ready[k] }), h('dd', { textContent: v })]));
  $('ready-empty').hidden = items.length > 0;
  $('read-aloud').hidden = !items.length || !localVoice();
  portal?.refresh();
}

// Read aloud only with a voice that runs on the phone: a network voice would send the amount and UTRs away.
function localVoice() {
  if (!('speechSynthesis' in window)) return null;
  return speechSynthesis.getVoices().find((v) => v.localService && v.lang.toLowerCase().replace('_', '-').startsWith(LANG)) || null;
}
if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', renderReady);
$('read-aloud').addEventListener('click', () => {
  const voice = localVoice();
  if (!voice) return;
  speechSynthesis.cancel();
  // Long numbers are read digit by digit so they can be written down.
  const say = readyItems().map(([k, v]) => `${T.ready[k]}: ${k === 'utrs' ? v.replace(/[A-Z0-9]/g, '$& ') : v}`).join('. ');
  speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(say), { voice, lang: voice.lang, rate: 0.85 }));
});

// One rule for the acknowledgement number, wherever it is typed: 14 digits, and the first digit explained.
function saveAck(input) {
  const info = ackInfo(input);
  if (!info.ok) return T.ackInvalid;
  saveCase(markDone({ ...kase, ack: info.value }, 'call', true)); // the number only arrives after the call, so step 1 is done
  return `${T.ackSaved} ${{ portal: T.portal.ackPortal, call: T.portal.ackCall, other: T.portal.ackOther }[info.kind]}`;
}
$('ack-save').addEventListener('click', () => {
  $('ack-status').textContent = saveAck(val('ack'));
  if (!ackInfo(val('ack')).ok) $('ack').focus();
});

// ---------- Step 2: proof: files or pasted text -> cards -> case ----------
const ocrStatus = $('ocr-status');

// A WhatsApp export becomes plain lines; anything else passes through unchanged.
function chatText(text) {
  const msgs = parseWhatsApp(text);
  return msgs.length ? msgs.map((m) => `${m.sender}: ${m.text}`).join('\n\n') : text;
}

async function readFiles(files) {
  const texts = [];
  const images = [];
  for (const f of [...files].slice(0, 20)) {
    if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) {
      try {
        for (const t of await zipTexts(await f.arrayBuffer())) texts.push(chatText(t.text));
      } catch {
        ocrStatus.textContent = T.zipFailed;
      }
    } else if (/\.txt$/i.test(f.name) || f.type.startsWith('text/')) texts.push(chatText(await f.text()));
    else if (f.type.startsWith('image/') && f.size <= 15 * 1024 * 1024) images.push(f); // larger is not a screenshot
  }
  if (images.length) {
    ocrStatus.textContent = T.ocrLoading;
    let ocr;
    try {
      ocr = await import('/ocr.js');
      for (const [n, img] of images.entries()) {
        ocrStatus.textContent = fill(T.ocrReading, { n: n + 1, total: images.length });
        // Lines inside one message are joined; blank lines between messages are kept.
        texts.push((await ocr.readImage(img, LANG)).replace(/([^\n])\n(?!\n)/g, '$1 '));
      }
      ocrStatus.textContent = '';
    } catch (err) {
      ocrStatus.textContent = err?.message === 'slow' ? T.ocrSlow : T.ocrFailed;
      $('paste').open = true;
    } finally {
      ocr?.stopReading(); // frees the engine and the images it held
    }
  }
  showCards(texts);
}

function showCards(texts) {
  base = sanitize(kase);
  cards = findCards(texts, val('mobile'));
  if (!cards.length && !ocrStatus.textContent) ocrStatus.textContent = T.noneFound;
  if (!cards.length) $('paste').open = true;
  renderCards();
  $('review').hidden = !cards.length;
  if (cards.length) $('review-title').focus();
}

// The case gets only what was marked Correct: total of the correct amounts (computed here), their UTRs,
// the earliest correct date, and a bank from the known list. Marking Wrong takes it out again.
function syncCase() {
  const ok = (kind) => cards.filter((c) => c.kind === kind && c.state === 'ok').map((c) => c.value);
  const shown = new Set(cards.filter((c) => c.kind === 'utr').map((c) => c.value.toUpperCase()));
  const amounts = ok('amount');
  const dates = ok('when').map(toIso).filter(Boolean).sort();
  const next = {
    ...base,
    utrs: [...(base.utrs || []).filter((u) => !shown.has(u)), ...ok('utr').map((u) => u.replace(/\s/g, '').toUpperCase())],
    amount: amounts.length ? amounts.reduce((sum, a) => sum + amountValue(a), 0).toFixed(2) : base.amount,
    lossAt: [dates[0], base.lossAt].filter(Boolean).sort()[0],
    bank: canonicalBank(ok('bank').at(-1)) || base.bank,
  };
  saveCase(cards.some((c) => c.state === 'ok') ? markDone(next, 'proof', true) : next);
}

function renderCards() {
  const groups = new Map();
  for (const c of cards) {
    const key = c.group ?? `solo-${c.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  $('cards').replaceChildren(...[...groups.values()].map((list) => h('div', { className: 'card-group' }, ...list.map(cardEl))));
}

function cardEl(c) {
  const value = h('p', { className: 'card-value', textContent: c.value });
  const state = h('p', { className: 'card-state', textContent: c.state === 'ok' ? T.confirmed : c.state === 'wrong' ? T.leftOut : '' });
  const btn = (label, onClick, pressed) => {
    const b = h('button', { type: 'button', className: 'secondary', textContent: label });
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  };
  const set = (st) => { c.state = c.state === st ? 'new' : st; syncCase(); renderCards(); $(`card-${c.id}`)?.querySelector('button')?.focus(); };
  const edit = () => {
    const input = h('input', { type: 'text', value: c.value, spellcheck: false, id: `edit-${c.id}` });
    input.setAttribute('aria-label', T.kinds[c.kind]);
    const save = btn(T.saveEdit, () => {
      c.value = input.value.trim() || c.value;
      c.state = 'new'; // an edited value still needs Correct before it reaches the case
      syncCase();
      renderCards();
    });
    value.replaceWith(h('div', { className: 'inline-field' }, input, save));
    input.focus();
  };
  const el = h('div', { className: 'card', id: `card-${c.id}` },
    h('p', { className: 'card-kind', textContent: T.kinds[c.kind] }),
    value,
    h('p', { className: 'card-source', textContent: `${T.fromLine} ${c.source}` }),
    h('div', { className: 'card-actions' }, btn(T.correct, () => set('ok'), c.state === 'ok'), btn(T.wrong, () => set('wrong'), c.state === 'wrong'), btn(T.edit, edit)),
    state);
  el.dataset.state = c.state;
  el.dataset.kind = c.kind;
  return el;
}

$('files').addEventListener('change', (e) => {
  readFiles(e.target.files).finally(() => { e.target.value = ''; }); // the picked files are not kept
});
$('find').addEventListener('click', () => {
  ocrStatus.textContent = '';
  showCards([$('sms').value]);
});

// A typed bank name is kept only if it is one of the known banks, never as free text.
$('bank').addEventListener('change', () => {
  const name = canonicalBank(val('bank'));
  if (name) saveCase({ ...kase, bank: name });
});

// Files shared to the app from WhatsApp, Gallery or Files arrive here from app.js, in memory.
export function receiveShare(files) {
  if (files?.length) readFiles(files);
}

// ---------- Voice for the letter: on the phone when possible, otherwise only after the person agrees ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = $('mic');
const micStatus = $('mic-status');
const SPEECH_LANG = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' }[LANG] || 'en-IN';
let rec = null;

async function onDeviceStatus() {
  if (typeof SR?.available !== 'function') return 'unavailable';
  try {
    return await SR.available({ langs: [SPEECH_LANG], processLocally: true });
  } catch {
    return 'unavailable';
  }
}

function askConsent() {
  return new Promise((resolve) => {
    const yes = h('button', { type: 'button', className: 'primary', textContent: T.consentYes });
    const no = h('button', { type: 'button', className: 'secondary', textContent: T.consentNo });
    const dlg = h('dialog', { className: 'consent' },
      h('h2', { id: 'consent-title', textContent: T.consentTitle }), h('p', { textContent: T.consentBody }), h('div', { className: 'actions' }, yes, no));
    dlg.setAttribute('aria-labelledby', 'consent-title');
    const done = (ok) => { dlg.close(); dlg.remove(); resolve(ok); };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dlg);
    dlg.showModal();
    no.focus();
  });
}

function setListening(on) {
  micBtn.setAttribute('aria-pressed', String(on));
  micBtn.classList.toggle('live', on);
  $('mic-label').textContent = on ? T.micStop : T.mic;
}

function listen(local) {
  const mine = new SR();
  rec = mine;
  rec.lang = SPEECH_LANG;
  rec.continuous = true;
  rec.interimResults = true;
  if (local) rec.processLocally = true;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const said = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) story.value = `${story.value.trimEnd()} ${said}`.trim();
      else interim += `${said} `;
    }
    $('mic-interim').textContent = interim.trim(); // shown, not announced: a live region would read every word
  };
  rec.onerror = (e) => {
    micStatus.textContent = e.error === 'not-allowed' ? T.micDenied : e.error === 'network' ? T.micNetwork : T.micError;
  };
  rec.onend = () => { if (rec === mine) { rec = null; setListening(false); $('mic-interim').textContent = ''; } };
  rec.start();
  setListening(true);
  micStatus.textContent = local ? T.micLocal : T.micListening;
}

let starting = false;
async function toggleMic() {
  if (rec) { rec.stop(); return; }
  if (starting) return; // a second tap while the first is still checking must not start a second recorder
  starting = true;
  try {
    await startMic();
  } finally {
    starting = false;
  }
}

async function startMic() {
  let status = await onDeviceStatus();
  if (status === 'downloadable' || status === 'downloading') {
    micStatus.textContent = T.micDownloading;
    status = (await SR.install({ langs: [SPEECH_LANG], processLocally: true }).catch(() => false)) ? 'available' : 'unavailable';
  }
  if (status === 'available') return listen(true);
  if (await askConsent()) listen(false);
  else story.focus();
}

if (SR) {
  micBtn.hidden = false;
  micBtn.addEventListener('click', () => toggleMic().catch(() => { micStatus.textContent = T.micError; setListening(false); }));
}

// ---------- The letter: an output of the case ----------
const longDate = (d) => d.toLocaleDateString(`${LANG}-IN`, { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' });

function data() {
  const channel = $('channel');
  const type = $('fraud-type');
  // Rows from cards marked Correct; without any, the saved case still gives the UTRs and the total.
  const okRows = [...new Set(cards.filter((c) => c.group !== null && c.state === 'ok').map((c) => c.group))].map((g) => {
    const get = (kind) => cards.find((c) => c.group === g && c.kind === kind && c.state === 'ok');
    return { when: get('when')?.value || '', amount: get('amount')?.value || '', utr: get('utr')?.value || '', to: get('payee')?.value || '', mode: get('payee')?.mode || '', from: get('payee')?.from || '' };
  });
  const rows = okRows.length ? okRows : (kase.utrs || []).map((utr) => ({ utr }));
  return {
    recipient: form.querySelector('input[name="recipient"]:checked')?.value || 'police',
    name: val('name'), mobile: val('mobile'), email: val('email'), address: val('address'),
    bank: val('bank') || kase.bank || '', ack: kase.ack || '',
    firstContact: val('first-contact') && longDate(new Date(`${val('first-contact')}T00:00`)),
    channel: channel.value ? channel.selectedOptions[0].textContent : '',
    typeName: type.value ? type.selectedOptions[0].textContent : '',
    story: story.value,
    payments: rows,
    total: okRows.some((r) => r.amount) ? undefined : Number(kase.amount || 0),
    contacts: $('contacts').value.split('\n').map((x) => x.trim()).filter(Boolean),
    date: longDate(new Date()),
  };
}

function renderDoc() {
  const r = buildReport(data(), T.doc);
  const doc = $('doc');
  const sections = r.sections.map((s, i) => h('section', {},
    h('h3', { textContent: `${i + 1}. ${s.title}` }),
    s.rows && h('dl', {}, ...s.rows.flatMap(([k, v]) => [h('dt', { textContent: k }), h('dd', { textContent: v })])),
    s.quote && h('blockquote', { textContent: s.quote }),
    s.table && h('div', { className: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { textContent: '#' }), ...s.table.head.map((c) => h('th', { scope: 'col', textContent: c })))),
      h('tbody', {}, ...s.table.rows.map((row, n) => h('tr', {}, h('td', { textContent: String(n + 1) }), ...row.map((c) => h('td', { textContent: c }))))))),
    ...(s.paras || []).map((p) => h('p', { textContent: p })),
    s.itemsTitle && h('p', { className: 'items-title', textContent: s.itemsTitle }),
    s.items && h('ul', { className: s.checklist ? 'checklist' : '' }, ...s.items.map((x) => h('li', { textContent: x })))));
  doc.replaceChildren(
    h('p', { className: 'doc-to' }, ...r.to.flatMap((l, i) => (i ? [h('br'), l] : [l]))),
    h('p', { className: 'doc-date', textContent: r.date }),
    h('p', { className: 'doc-subject', textContent: r.subject }),
    h('p', { textContent: r.salutation }),
    ...r.intro.map((p) => h('p', { textContent: p })),
    ...sections,
    h('p', { className: 'doc-declaration', textContent: r.declaration }),
    h('dl', { className: 'doc-sign' }, ...r.sign.flatMap(([k, v]) => [h('dt', { textContent: k }), h('dd', { textContent: v || ' ' })])),
    h('p', { className: 'doc-footer', textContent: r.footer }),
  );
  return r;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!story.value.trim()) {
    $('form-status').textContent = T.needStory;
    story.focus();
    return;
  }
  $('form-status').textContent = '';
  if (story.value !== extractedFrom.story) {
    const fromProof = scammerIds();
    $('contacts').value = [...new Set([...extractContacts(story.value, val('mobile')), ...fromProof])].join('\n');
    $('fraud-type').value = check(story.value).type || '';
  }
  extractedFrom.story = story.value;
  renderDoc();
  $('preview').hidden = false;
  $('preview').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
});

// Any later edit in the letter form updates the letter.
form.addEventListener('input', () => { if (!$('preview').hidden) renderDoc(); });
$('fraud-type').addEventListener('change', () => { if (!$('preview').hidden) renderDoc(); });

const docStatus = $('doc-status');
$('print').addEventListener('click', () => { renderDoc(); window.print(); });
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(reportText(renderDoc()));
    docStatus.textContent = T.copied;
  } catch {
    docStatus.textContent = T.copyFail;
  }
});
$('share').addEventListener('click', async () => {
  const r = renderDoc();
  const text = reportText(r);
  if (navigator.share) {
    try {
      await navigator.share({ title: r.subject, text });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  // Long mailto links fail silently in some mail apps, so a long letter is copied and pasted instead.
  if (text.length > 1800) {
    try {
      await navigator.clipboard.writeText(text);
      docStatus.textContent = T.copied;
    } catch {
      docStatus.textContent = T.copyFail;
      return;
    }
    location.href = `mailto:?subject=${encodeURIComponent(r.subject)}`;
  } else {
    location.href = `mailto:?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(text)}`;
  }
});

// ---------- Clear everything: the saved case and everything on the page ----------
const micHint = micStatus.textContent;
$('clear').addEventListener('click', () => {
  rec?.abort();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  extractedFrom = { story: null };
  cards = [];
  base = {};
  micStatus.textContent = micHint;
  for (const id of ['mic-interim', 'doc-status', 'ack-status', 'ocr-status', 'form-status', 'walk-status', 'portal-ack-status']) $(id).textContent = '';
  $('portal-ack').value = '';
  portal.clear();
  $('cards').replaceChildren();
  form.reset();
  for (const id of ['contacts', 'sms', 'bank', 'ack']) $(id).value = '';
  $('fraud-type').value = '';
  for (const id of ['review', 'preview']) $(id).hidden = true;
  $('doc').replaceChildren();
  saveCase({});
  $('clear-status').textContent = T.caseCleared;
});

// Step 4: the portal walk-through, with the case's values ready to copy.
portal = initPortal({
  T,
  saveAck,
  getValues: () => ({
    when: kase.lossAt ? formatDate(kase.lossAt, LANG) : '',
    amount: kase.amount || '',
    utrs: kase.utrs || [],
    bank: kase.bank || '',
    scammer: scammerIds(),
  }),
});

renderCase();
