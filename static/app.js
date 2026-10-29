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

// A shared message is kept only until the next page load. Every page deletes it;
// the Check page shows it first when it was opened by a share.
async function takeShared() {
  if (!('caches' in window)) return '';
  const cache = await caches.open('gh-share');
  const hit = await cache.match('/__shared__');
  await cache.delete('/__shared__');
  return hit ? hit.text() : '';
}

const typeOf = (out) => labels.types[out.type ?? 'unknown'];

function show(out) {
  const v = labels.verdicts[out.verdict];
  $('verdict').textContent = v.title;
  $('verdict-body').textContent = v.body;
  $('result').dataset.verdict = out.verdict;
  const t = out.verdict === 'none' ? null : typeOf(out);
  $('type').textContent = t ? t.name : '';
  $('rule').textContent = t ? t.rule : '';
  $('found').replaceChildren(...out.signs.map((k) => Object.assign(document.createElement('li'), { textContent: labels.signNames[k] })));
  $('signs-title').hidden = out.signs.length === 0;
  $('result').hidden = false;
  $('fallback').hidden = true;
}

function runCheck() {
  const text = msg.value.trim();
  if (!text) {
    status.textContent = strings.empty;
    msg.focus();
    return;
  }
  status.textContent = '';
  show(check(text));
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
    const out = check(text);
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

const shared = takeShared().catch(() => '');

// The report maker loads only on its own page; if it fails, the page keeps its no-JavaScript message.
if ($('report-form')) import('/report.js').catch(() => {});

if (msg && ask && run && status && strings && labels) {
  ask.hidden = false;
  ask.addEventListener('click', askFamily);
  msg.addEventListener('input', () => {
    $('result').hidden = true;
    $('fallback').hidden = false;
  });
  import('/rules.js')
    .then(async (rules) => {
      check = rules.check;
      run.hidden = false;
      run.addEventListener('click', runCheck);
      const text = await shared;
      if (opened && text && !msg.value) {
        msg.value = text;
        show(check(text));
        $('result').focus(); // so screen readers announce the verdict that appeared without a tap
      }
    })
    .catch(async () => {
      // Rules failed to load: still show a shared message so the user can ask family.
      const text = await shared;
      if (opened && text && !msg.value) msg.value = text;
    });
}
