// Portal copilot: walks the cybercrime.gov.in financial fraud complaint one stage at a time, with the
// case's values ready to copy. It never fills, submits or opens the portal inside the app: the person
// types the OTP and CAPTCHA and presses Submit on the official site themselves.
const MAX_UPLOAD = 5 * 1024 * 1024; // the portal's per-file limit, as reported

const $ = (id) => document.getElementById(id);
const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
};
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const size = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

// Re-encodes an image as JPEG under the limit: lower quality first, then smaller sides.
// Exported for the evidence tool only; the image never leaves memory.
export async function toJpegUnder(file, limit = MAX_UPLOAD) {
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 4000 / Math.max(bitmap.width, bitmap.height));
  try {
    for (let tries = 0; tries < 12; tries++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // JPEG has no transparency
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const q of [0.9, 0.8, 0.7, 0.6]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
        if (blob && blob.size < limit) return blob;
      }
      scale *= 0.75;
    }
    throw new Error('could not get under the limit');
  } finally {
    bitmap.close?.();
  }
}

export function initPortal({ T, getValues, saveAck }) {
  const P = T.portal;
  const stages = [...document.querySelectorAll('#stages > .stage')];
  const status = $('walk-status');
  let current = 0;

  function show(n) {
    current = Math.max(0, Math.min(stages.length - 1, n));
    stages.forEach((st, i) => { st.hidden = i !== current; });
    $('stage-count').textContent = fill(P.stageN, { n: current + 1, total: stages.length });
    $('stage-back').disabled = current === 0;
    $('stage-next').disabled = current === stages.length - 1;
    renderValues();
  }

  // Value rows with a Copy button. Missing values say where they come from instead of showing a blank.
  function renderValues() {
    const values = getValues();
    for (const box of document.querySelectorAll('.stage-values')) {
      const rows = box.dataset.values.split(',').flatMap((key) => {
        const v = values[key];
        const list = Array.isArray(v) ? v : v ? [v] : [];
        return list.map((value) => {
          const copy = h('button', { type: 'button', className: 'secondary copy-btn', textContent: P.copy });
          copy.setAttribute('aria-label', `${P.copy}: ${T.ready[key]} ${value}`);
          copy.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(value);
              status.textContent = fill(P.copied, { value });
            } catch {
              status.textContent = '';
            }
          });
          return h('div', { className: 'copy-row' }, h('span', { className: 'copy-label', textContent: T.ready[key] }), h('span', { className: 'copy-value', textContent: value }), copy);
        });
      });
      box.replaceChildren(...(rows.length ? rows : [h('p', { className: 'hint', textContent: P.notYet })]));
    }
  }

  $('stage-back').addEventListener('click', () => { show(current - 1); $('stage-back').focus(); });
  $('stage-next').addEventListener('click', () => { show(current + 1); (current === stages.length - 1 ? $('stage-back') : $('stage-next')).focus(); });

  // Evidence: copies under 5 MB, offered as downloads with clear names. Nothing is kept after the page closes.
  let urls = [];
  $('evidence').addEventListener('change', async (e) => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    const list = $('evidence-list');
    list.replaceChildren();
    let n = 0;
    for (const file of [...e.target.files].slice(0, 20)) {
      n += 1;
      const name = `golden-hour-evidence-${String(n).padStart(2, '0')}.jpg`;
      try {
        const blob = await toJpegUnder(file);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        list.append(h('li', {}, h('a', { href: url, download: name, textContent: fill(P.evidenceReady, { name, size: size(blob.size) }) })));
      } catch {
        list.append(h('li', { textContent: P.evidenceFail }));
      }
    }
    e.target.value = '';
  });

  $('portal-ack-save').addEventListener('click', () => {
    const msg = saveAck($('portal-ack').value);
    $('portal-ack-status').textContent = msg;
  });

  for (const el of document.querySelectorAll('.stage-nav')) el.hidden = false;
  show(0);
  return { refresh: renderValues, clear: () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; $('evidence-list').replaceChildren(); } };
}
