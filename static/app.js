// Progressive enhancement only: every page works without this file.
// Never builds HTML from strings; user text is only ever set through .value or .textContent.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const $ = (id) => document.getElementById(id);
const msg = $('msg');
const ask = $('ask');
const run = $('run');
const status = $('status');
const strings = $('strings')?.dataset;
const labels = strings?.labels ? JSON.parse(strings.labels) : null;
let check = null; // loaded only on the Check page
let rules = null;
let lastOut = null; // the verdict on screen, including any cloud signals

// A share is held only in the service worker's memory, never in storage. Every page asks for it once,
// which also clears it; the Check page shows it when it was opened by a share. If the browser stopped
// the worker in between, the share is simply gone and the person shares or pastes again.
function takeShared() {
  const none = { text: '', files: [] };
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve(none);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(none), 3000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve({ text: typeof e.data?.text === 'string' ? e.data.text : '', files: Array.isArray(e.data?.files) ? e.data.files : [] });
    };
    sw.postMessage({ type: 'take-share' }, [channel.port2]);
  });
}

const typeOf = (out) => labels.types[out.type ?? 'unknown'];

// Up to three reasons: what the cloud check found first, then the phone's own signs. Each is one fixed sentence.
function reasonText([from, key], days) {
  return from === 'cloud' ? labels.cloud.signals[key].replace('{days}', days) : labels.signNames[key];
}

function show(out) {
  lastOut = out;
  const v = labels.verdicts[out.verdict];
  $('verdict').textContent = v.title;
  $('verdict-body').textContent = v.body;
  $('result').dataset.verdict = out.verdict;
  const t = out.verdict === 'none' ? null : typeOf(out);
  $('type').textContent = t ? t.name : '';
  $('rule').textContent = t ? t.rule : '';
  const reasons = (out.reasons || out.signs.map((k) => ['local', k])).slice(0, 3);
  $('found').replaceChildren(...reasons.map((r) => Object.assign(document.createElement('li'), { textContent: reasonText(r, 30) })));
  $('signs-title').hidden = reasons.length === 0;
  $('result').hidden = false;
  $('fallback').hidden = true;
}

// ---------- The cloud link check: only on tap, only the stripped link, never needed ----------
const worker = strings?.worker || '';
let cloudUrl = '';
let shotUrl = '';

function offerCloud(text, out) {
  $('video-note').hidden = !out.video;
  cloudUrl = rules.firstLink(text);
  $('cloud').hidden = !worker || !cloudUrl;
  $('cloud-result').hidden = true;
  $('cloud-status').textContent = '';
  $('cloud-run').disabled = false;
}

const fromBase64 = (b64) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' });

async function runCloud() {
  const L = labels.cloud;
  const local = check(msg.value.trim());
  $('cloud-run').disabled = true;
  $('cloud-status').textContent = L.running;
  try {
    const res = await fetch(`${worker}/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: cloudUrl }), // scheme, host and path only; the worker strips again
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      $('cloud-status').textContent = res.status === 429 ? L.busy : res.status === 403 ? L.blocked : res.status === 503 ? L.unavailable : L.failed;
      return;
    }
    const data = await res.json();
    if (shotUrl) URL.revokeObjectURL(shotUrl);
    shotUrl = typeof data.screenshot === 'string' && data.screenshot ? URL.createObjectURL(fromBase64(data.screenshot)) : '';
    $('cloud-shot').hidden = !shotUrl;
    if (shotUrl) $('cloud-shot').src = shotUrl;
    $('cloud-final').textContent = String(data.finalUrl || '');
    const chain = Array.isArray(data.chain) ? data.chain.map(String) : [];
    $('cloud-chain').replaceChildren(...chain.map((u) => Object.assign(document.createElement('li'), { textContent: u })));
    $('cloud-chain-box').hidden = chain.length < 2;
    const combined = rules.combine(local, Array.isArray(data.signals) ? data.signals.map(String) : []);
    show(combined);
    $('cloud-clean').hidden = combined.cloud.length > 0 || combined.verdict === 'likely';
    $('cloud-result').hidden = false;
    $('cloud-status').textContent = '';
  } catch {
    $('cloud-status').textContent = L.unavailable; // no worker, offline or too slow: the phone's result stands
  } finally {
    $('cloud-run').disabled = false;
  }
}

function runCheck() {
  const text = msg.value.trim();
  if (!text) {
    status.textContent = strings.empty;
    msg.focus();
    return;
  }
  status.textContent = '';
  const out = check(text);
  show(out);
  offerCloud(text, out);
  $('result').focus();
}

async function askFamily() {
  const text = msg.value.trim();
  if (!text) {
    status.textContent = strings.empty;
    msg.focus();
    return;
  }
  let full = `${strings.intro}\n\n${text}`;
  if (check) {
    const out = lastOut && !$('result').hidden ? lastOut : check(text);
    const t = out.verdict === 'none' ? '' : ` (${typeOf(out).name})`;
    full = `${strings.intro}\n\n${labels.intro} ${labels.verdicts[out.verdict].title}${t}\n\n${text}`;
  }
  if (navigator.share) {
    try {
      await navigator.share({ text: full });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(full);
    status.textContent = strings.copied;
  } catch {
    msg.select();
    status.textContent = strings.copyFail;
  }
}

const opened = new URLSearchParams(location.search).has('shared');
if (opened) history.replaceState(null, '', location.pathname);

const shared = takeShared().catch(() => ({ text: '', files: [] }));

// The journey script loads only on its own page; if it fails, the page keeps its no-JavaScript message.
// Files shared to the app (screenshots, a chat export) are handed to its proof step.
if ($('report-form')) {
  import('/report.js')
    .then(async (journey) => { if (opened) { const s = await shared; journey.receiveShare(s.files, s.text); } })
    .catch(() => {});
}

// Home: the "I lost money" door names the next step of a saved case.
const helpSub = $('help-sub');
if (helpSub) {
  let saved = null;
  try {
    saved = localStorage.getItem('gh-case-v1');
  } catch {
    // storage blocked: keep the default line
  }
  if (saved) {
    import('/case-core.js').then(({ parseCase, nextStep }) => {
      const step = nextStep(parseCase(saved));
      if (step) helpSub.textContent = helpSub.dataset.next.replace('{step}', JSON.parse(helpSub.dataset.steps)[step]);
    }).catch(() => {});
  }
}

// Home: Install app. Chrome and Android offer a real prompt; elsewhere (iOS Safari, Firefox) the button
// shows short Add to Home Screen instructions. Hidden when already running as the installed app.
const install = $('install');
if (install) {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let prompt = null;
  const btn = $('install-btn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    install.hidden = standalone;
  });
  window.addEventListener('appinstalled', () => { install.hidden = true; });
  // No prompt event after load: this browser does not offer one, so offer instructions instead.
  if (!standalone) setTimeout(() => { install.hidden = false; }, 1500);
  btn.addEventListener('click', async () => {
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      prompt = null;
      if (outcome === 'accepted') install.hidden = true;
      return;
    }
    const help = $('install-help');
    help.hidden = !help.hidden;
    btn.setAttribute('aria-expanded', String(!help.hidden));
  });
}

if (msg && ask && run && status && strings && labels) {
  ask.hidden = false;
  ask.addEventListener('click', askFamily);
  msg.addEventListener('input', () => {
    $('result').hidden = true;
    $('fallback').hidden = false;
    $('cloud').hidden = true;
    $('video-note').hidden = true;
  });
  import('/rules.js')
    .then(async (mod) => {
      rules = mod;
      check = rules.check;
      run.hidden = false;
      run.addEventListener('click', runCheck);
      $('cloud-run').addEventListener('click', runCloud);
      const { text } = await shared;
      if (opened && text && !msg.value) {
        msg.value = text;
        const out = check(text);
        show(out);
        offerCloud(text, out);
        $('result').focus(); // so screen readers announce the verdict that appeared without a tap
      }
    })
    .catch(async () => {
      // Rules failed to load: still show a shared message so the user can ask family.
      const { text } = await shared;
      if (opened && text && !msg.value) msg.value = text;
    });
}
