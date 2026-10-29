// Progressive enhancement only: every page works without this file.
// Never builds HTML from strings; user text is only ever set through .value or .textContent.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const msg = document.getElementById('msg');
const ask = document.getElementById('ask');
const status = document.getElementById('status');
const strings = document.getElementById('strings')?.dataset;

// A shared message is kept only until the next page load. Every page deletes it;
// the Check page shows it first when it was opened by a share.
async function takeShared() {
  if (!('caches' in window)) return '';
  const cache = await caches.open('gh-share');
  const hit = await cache.match('/__shared__');
  await cache.delete('/__shared__');
  return hit ? hit.text() : '';
}

async function askFamily() {
  const text = msg.value.trim();
  if (!text) {
    status.textContent = strings.empty;
    msg.focus();
    return;
  }
  const full = `${strings.intro}\n\n${text}`;
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

takeShared()
  .then((text) => {
    if (opened && text && msg) msg.value = text;
  })
  .catch(() => {});

if (msg && ask && status && strings) {
  ask.hidden = false;
  ask.addEventListener('click', askFamily);
}
