// The "I lost money" journey: the case on this phone, the call card, proof, and the complaint letter.
// Loaded by app.js only on the journey page. Builds DOM with textContent only, never from HTML strings.
// Only case-core's sanitized fields ever reach localStorage; names, numbers and the story stay in memory.
import { check } from './rules.js';
import { extractPayments, extractContacts, buildReport, reportText, totalLost } from './report-core.js';
import { CASE_KEY, parseCase, sanitize, markDone, nextStep, formatDate, formatAmount, toIso } from './case-core.js';

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
let payments = []; // this visit only; the case keeps just the total and the UTRs
let extractedFrom = { sms: null, story: null }; // re-extract only text that changed, keeping corrections

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
  if (kase.bank && !val('bank')) $('bank').value = kase.bank;
  renderReady();
}

for (const btn of document.querySelectorAll('[data-done]')) {
  btn.addEventListener('click', () => saveCase(markDone(kase, btn.dataset.done, !kase.done?.[btn.dataset.done])));
}

// ---------- Step 1: what to have ready for the 1930 call ----------
const scammerIds = () => [...new Set(payments.map((p) => p.to).filter((x) => /@|^\+?\d[\d\s-]{9,}$/.test(x)))];

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

$('ack-save').addEventListener('click', () => {
  const ack = val('ack').replace(/\s/g, '');
  if (!/^\d{14}$/.test(ack)) {
    $('ack-status').textContent = T.ackInvalid;
    $('ack').focus();
    return;
  }
  saveCase(markDone({ ...kase, ack }, 'call', true)); // the number only arrives after the call, so step 1 is done
  $('ack-status').textContent = T.ackSaved;
});

// ---------- Step 2: proof ----------
const COLS = ['when', 'amount', 'mode', 'utr', 'to', 'from'];

function renderPayments() {
  const box = $('payments');
  if (!payments.length) {
    box.replaceChildren(h('p', { className: 'empty', textContent: T.noPayments }));
    return;
  }
  box.replaceChildren(...payments.map((p, n) => {
    const inputs = COLS.map((k) => {
      const id = `pay-${n}-${k}`;
      const input = h('input', { id, value: p[k], type: 'text', spellcheck: false });
      if (k === 'amount') input.inputMode = 'decimal';
      input.addEventListener('input', () => { p[k] = input.value; renderReady(); if (!$('preview').hidden) renderDoc(); });
      return h('div', { className: 'field' }, h('label', { htmlFor: id, textContent: T.doc.col[k] }), input);
    });
    const remove = h('button', { type: 'button', className: 'text-button', textContent: T.removePayment });
    remove.addEventListener('click', () => {
      payments.splice(n, 1);
      renderPayments();
      if (!$('preview').hidden) renderDoc();
      ($(`pay-${Math.min(n, payments.length - 1)}-when`) || $('add-payment')).focus();
    });
    return h('fieldset', { className: 'payment' }, h('legend', { textContent: fill(T.paymentN, { n: n + 1 }) }), h('div', { className: 'grid-3' }, ...inputs), remove);
  }));
}

$('find').addEventListener('click', () => {
  if ($('sms').value !== extractedFrom.sms) payments = extractPayments($('sms').value);
  extractedFrom.sms = $('sms').value;
  renderPayments();
  renderReady();
  $('review').hidden = false;
  $('review-title').focus();
});

$('add-payment').addEventListener('click', () => {
  payments.push(Object.fromEntries(COLS.map((k) => [k, ''])));
  renderPayments();
  $(`pay-${payments.length - 1}-when`).focus();
});

$('save-case').addEventListener('click', () => {
  const total = totalLost(payments);
  const dates = payments.map((p) => toIso(p.when)).filter(Boolean).sort();
  saveCase(markDone({
    ...kase,
    amount: total ? total.toFixed(2) : kase.amount,
    utrs: [...(kase.utrs || []), ...payments.map((p) => p.utr.trim().toUpperCase())],
    lossAt: dates[0] || kase.lossAt,
    bank: val('bank') || kase.bank,
  }, 'proof', true));
  $('save-status').textContent = T.caseSaved;
});

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
  // Without this visit's payments, the saved case still gives the UTRs and the total.
  const rows = payments.length ? payments : (kase.utrs || []).map((utr) => ({ utr }));
  return {
    recipient: form.querySelector('input[name="recipient"]:checked')?.value || 'police',
    name: val('name'), mobile: val('mobile'), email: val('email'), address: val('address'),
    bank: val('bank') || kase.bank || '', ack: kase.ack || '',
    firstContact: val('first-contact') && longDate(new Date(`${val('first-contact')}T00:00`)),
    channel: channel.value ? channel.selectedOptions[0].textContent : '',
    typeName: type.value ? type.selectedOptions[0].textContent : '',
    story: story.value,
    payments: rows,
    total: payments.length ? undefined : Number(kase.amount || 0),
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
  extractedFrom = { sms: null, story: null };
  payments = [];
  micStatus.textContent = micHint;
  for (const id of ['mic-interim', 'doc-status', 'ack-status', 'save-status', 'form-status']) $(id).textContent = '';
  form.reset();
  for (const id of ['contacts', 'sms', 'bank', 'ack']) $(id).value = '';
  $('fraud-type').value = '';
  for (const id of ['review', 'preview']) $(id).hidden = true;
  $('doc').replaceChildren();
  saveCase({});
  $('clear-status').textContent = T.caseCleared;
});

renderCase();
