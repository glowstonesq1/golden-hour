// Report page: voice or typed story -> checked details -> formal complaint, all on the phone.
// Loaded by app.js only on the report page. Builds DOM with textContent only, never from HTML strings.
// Nothing is stored: closing the page or "Clear everything" removes it all.
import { check } from './rules.js';
import { extractPayments, extractContacts, buildReport, reportText, unsupportedDetails } from './report-core.js';

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

const form = $('report-form');
const story = $('story');
let payments = [];
let summary = ''; // set only after the verifier passed; used only while the person ticks the box

$('nojs').hidden = true;
form.hidden = false;

// ---------- Voice: on the phone when possible, otherwise only after the person agrees ----------
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
      h('h2', { textContent: T.consentTitle }), h('p', { textContent: T.consentBody }), h('div', { className: 'actions' }, yes, no));
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
  rec = new SR();
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
    micStatus.textContent = interim.trim() || (local ? T.micLocal : T.micListening);
  };
  rec.onerror = (e) => {
    micStatus.textContent = e.error === 'not-allowed' ? T.micDenied : e.error === 'network' ? T.micNetwork : T.micError;
  };
  rec.onend = () => { rec = null; setListening(false); };
  rec.start();
  setListening(true);
  micStatus.textContent = local ? T.micLocal : T.micListening;
}

async function toggleMic() {
  if (rec) { rec.stop(); return; }
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

// ---------- Details the person checks and fixes ----------
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
      input.addEventListener('input', () => { p[k] = input.value; renderDoc(); });
      return h('div', { className: 'field' }, h('label', { htmlFor: id, textContent: T.doc.col[k] }), input);
    });
    const remove = h('button', { type: 'button', className: 'text-button', textContent: T.removePayment });
    remove.addEventListener('click', () => { payments.splice(n, 1); renderPayments(); renderDoc(); });
    return h('fieldset', { className: 'payment' }, h('legend', { textContent: fill(T.paymentN, { n: n + 1 }) }), h('div', { className: 'grid-3' }, ...inputs), remove);
  }));
}

const val = (id) => $(id).value.trim();

function data() {
  const channel = $('channel');
  const type = check(story.value).type;
  return {
    recipient: form.querySelector('input[name="recipient"]:checked')?.value || 'police',
    name: val('name'), mobile: val('mobile'), email: val('email'), address: val('address'), bank: val('bank'), ack: val('ack'),
    firstContact: val('first-contact') && new Date(`${val('first-contact')}T00:00`).toLocaleDateString(`${LANG}-IN`, { day: 'numeric', month: 'long', year: 'numeric' }),
    channel: channel.value ? channel.selectedOptions[0].textContent : '',
    typeName: type ? T.types[type] : '',
    story: story.value,
    summary: $('ai-ok').checked ? summary && $('ai-text').value : '',
    payments,
    contacts: $('contacts').value.split('\n').map((x) => x.trim()).filter(Boolean),
    date: new Date().toLocaleDateString(`${LANG}-IN`, { day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

// ---------- The letter ----------
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

function reveal(el) {
  el.hidden = false;
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!story.value.trim()) {
    $('form-status').textContent = T.needStory;
    story.focus();
    return;
  }
  $('form-status').textContent = '';
  payments = extractPayments($('sms').value);
  $('contacts').value = extractContacts(story.value, val('mobile')).join('\n');
  renderPayments();
  renderDoc();
  $('preview').hidden = false;
  reveal($('review'));
  $('review-title').focus({ preventScroll: true });
});

// Any later edit anywhere updates the letter.
form.addEventListener('input', () => { if (!$('preview').hidden) renderDoc(); });
$('contacts').addEventListener('input', renderDoc);
$('add-payment').addEventListener('click', () => {
  payments.push(Object.fromEntries(COLS.map((k) => [k, ''])));
  renderPayments();
  renderDoc();
  $(`pay-${payments.length - 1}-when`).focus();
});

// ---------- On-device AI summary (only where the browser has it, English only) ----------
const AI_OPTS = { type: 'tldr', format: 'plain-text', length: 'medium', expectedInputLanguages: ['en'], outputLanguage: 'en',
  sharedContext: "A fraud victim's own account, for a police complaint. Keep every fact exactly as given. Add nothing." };

async function aiReady() {
  if (LANG !== 'en' || !('Summarizer' in self)) return false;
  try {
    return (await self.Summarizer.availability(AI_OPTS)) !== 'unavailable';
  } catch {
    return false;
  }
}

async function runAi() {
  const status = $('ai-status');
  $('ai-run').disabled = true;
  status.textContent = T.aiWorking;
  try {
    const s = await self.Summarizer.create({
      ...AI_OPTS,
      monitor: (m) => m.addEventListener('downloadprogress', (e) => { status.textContent = fill(T.aiDownloading, { p: Math.round(e.loaded * 100) }); }),
    });
    const out = (await s.summarize(story.value)).trim();
    s.destroy?.();
    const source = [story.value, $('sms').value, ...['name', 'mobile', 'email', 'address', 'bank', 'ack', 'first-contact'].map(val)].join('\n');
    if (!out || unsupportedDetails(out, source).length) {
      summary = '';
      $('ai-result').hidden = true;
      status.textContent = out ? T.aiRejected : T.aiFailed;
    } else {
      summary = out;
      $('ai-text').value = out;
      $('ai-ok').checked = false;
      $('ai-result').hidden = false;
      status.textContent = '';
    }
  } catch {
    status.textContent = T.aiFailed;
  } finally {
    $('ai-run').disabled = false;
    renderDoc();
  }
}

aiReady().then((ok) => { if (ok) $('ai').hidden = false; });
$('ai-run').addEventListener('click', runAi);
$('ai-ok').addEventListener('change', renderDoc);
$('ai-text').addEventListener('input', renderDoc);

// ---------- Print, copy, share ----------
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
  location.href = `mailto:?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(text)}`;
});

$('next-toggle').addEventListener('click', () => {
  const open = $('next').hidden;
  $('next-toggle').setAttribute('aria-expanded', String(open));
  if (open) reveal($('next'));
  else $('next').hidden = true;
});

$('clear').addEventListener('click', () => {
  rec?.abort();
  form.reset();
  for (const id of ['contacts', 'ai-text']) $(id).value = '';
  payments = [];
  summary = '';
  for (const id of ['review', 'preview', 'next', 'ai-result']) $(id).hidden = true;
  $('next-toggle').setAttribute('aria-expanded', 'false');
  $('doc').replaceChildren();
  $('form-status').textContent = T.cleared;
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  story.focus({ preventScroll: true });
});
