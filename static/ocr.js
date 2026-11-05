// On-device text reading for screenshots, with the vendored Tesseract.js (no CDN, nothing uploaded).
// Loaded only when someone picks or shares a screenshot. The engine and language data are fetched from
// this site once and kept by the service worker's runtime cache, not the offline precache.
// cacheMethod 'none' stops Tesseract.js from writing its own copy into IndexedDB.
const BASE = '/vendor/tesseract';
const LANGS = { en: ['eng'], hi: ['eng', 'hin'], mr: ['eng', 'mar'] };
let worker = null;
let onLog = () => {};

export async function readImage(file, lang, progress, timeoutMs = 120000) {
  onLog = progress || (() => {});
  if (!worker) {
    worker = import(`${BASE}/tesseract.esm.min.js`).then(({ default: T }) => T.createWorker(LANGS[lang] || LANGS.en, 1, {
      workerPath: `${BASE}/worker.min.js`,
      corePath: `${BASE}/core`,
      langPath: '/vendor/tessdata',
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (m) => onLog(m),
    }));
  }
  const w = await worker;
  let timer;
  const slow = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('slow')), timeoutMs); });
  try {
    const { data } = await Promise.race([w.recognize(file), slow]);
    return data.text;
  } finally {
    clearTimeout(timer);
  }
}

// Frees the engine and its memory (and stops it if it was too slow). Safe to call more than once.
export async function stopReading() {
  const w = worker;
  worker = null;
  try {
    await (await w)?.terminate();
  } catch {
    // already gone
  }
}
