// OCR accuracy on the synthetic screenshot set: renders each image, reads it with the app's own OCR
// (vendored Tesseract.js, in a real browser), runs the app's own card extraction, and scores each field.
// Usage: node eval/ocr.mjs http://127.0.0.1:8080   (serve dist first, as for tests/e2e.mjs)
// Writes eval/ocr-results.json; eval/run.mjs includes it in eval/results.md.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { ocrSet } from './ocr-set.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const html = (item) => {
  const body = esc(item.text).replace(/\n/g, '<br>');
  const box = item.look === 'sms'
    ? `<div style="background:#ececec;border-radius:14px;padding:12px 14px">${body}</div>`
    : `<div style="border:1px solid #ddd;border-radius:16px;padding:18px;text-align:center;line-height:1.7">${body}</div>`;
  return `<div id="m" style="width:360px;padding:16px;font:17px FreeSans,sans-serif;background:#fff;color:#111">${box}</div>`;
};

// Character error rate: edit distance between what was read and what was drawn, per character drawn.
function cer(read, truth) {
  const a = read.replace(/\s+/g, ' ').trim();
  const b = truth.replace(/\s+/g, ' ').trim();
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / Math.max(1, b.length);
}

const browser = await chromium.launch();
const render = await browser.newPage();
const app = await browser.newPage();
await app.goto(`${BASE}/help/`);
const items = ocrSet().sort((x, y) => x.lang.localeCompare(y.lang));
const rows = [];
let lang = null;
for (const item of items) {
  await render.setContent(html(item));
  const png = (await render.locator('#m').screenshot()).toString('base64');
  if (lang && lang !== item.lang) await app.evaluate(async () => (await import('/ocr.js')).stopReading());
  lang = item.lang;
  const started = Date.now();
  const { text, cards } = await app.evaluate(async ([b64, l]) => {
    const { readImage } = await import('/ocr.js');
    const { findCards } = await import('/proof-core.js');
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' });
    // Same handling as the app: lines inside one message are joined.
    const read = (await readImage(blob, l)).replace(/([^\n])\n(?!\n)/g, '$1 ');
    return { text: read, cards: findCards([read]).map((c) => [c.kind, c.value]) };
  }, [png, item.lang]);
  const got = Object.fromEntries(Object.keys(item.fields).map((k) => [k, cards.some(([kind, v]) => kind === k && v === item.fields[k])]));
  rows.push({ id: item.id, split: item.split, lang: item.lang, fields: got, cer: cer(text, item.text), ms: Date.now() - started });
}
await browser.close();

const summary = {};
for (const split of ['dev', 'test']) {
  const r = rows.filter((x) => x.split === split);
  const field = {};
  for (const k of ['amount', 'when', 'utr', 'payee']) {
    const scored = r.filter((x) => k in x.fields);
    field[k] = [scored.filter((x) => x.fields[k]).length, scored.length];
  }
  const byLang = Object.fromEntries(['en', 'hi', 'mr'].map((l) => {
    const lr = r.filter((x) => x.lang === l);
    const all = lr.flatMap((x) => Object.values(x.fields));
    return [l, [all.filter(Boolean).length, all.length]];
  }));
  summary[split] = { images: r.length, field, byLang, cer: r.reduce((n, x) => n + x.cer, 0) / r.length, msPerImage: r.reduce((n, x) => n + x.ms, 0) / r.length };
}
await writeFile(new URL('./ocr-results.json', import.meta.url), `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
