// Progressive enhancement only: every page works without this file.
// Never builds HTML from strings; user text is only ever set through .value or .textContent.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const msg = document.getElementById('msg');
const ask = document.getElementById('ask');
const status = document.getElementById('status');
const strings = document.getElementById('strings')?.dataset;

async function loadShared() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  history.replaceState(null, '', location.pathname);
  if (!('caches' in window)) return;
  const cache = await caches.open('gh-share');
  const hit = await cache.match('/__shared__');
  await cache.delete('/__shared__');
  if (hit) msg.value = await hit.text();
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
  }
}

if (msg && ask && status && strings) {
  ask.hidden = false;
  ask.addEventListener('click', askFamily);
  loadShared().catch(() => {});
}
