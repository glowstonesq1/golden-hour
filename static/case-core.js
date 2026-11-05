// The person's case: what the recovery journey remembers between visits. Pure functions, no DOM,
// no storage, so Node tests run exactly what the page runs; report.js does the localStorage reads and writes.
//
// Privacy rule: the saved case may hold only dates, the amount, reference numbers and the bank's name.
// Never PAN, account or card numbers, OTPs, names, phone numbers, UPI IDs or the story. sanitize() is the
// only way into storage and drops anything else, so a bug elsewhere cannot widen what is kept.

export const CASE_KEY = 'gh-case-v1';

// Journey order. kind: 'urgent' = do now; 'suggest' = strongly advised, never shown as late;
// 'do' = a normal step; 'if' = only when it applies (money was held); 'end' = the goal.
export const STEPS = [
  { id: 'call', kind: 'urgent' },
  { id: 'proof', kind: 'do' },
  { id: 'block', kind: 'urgent' },
  { id: 'portal', kind: 'suggest' },
  { id: 'bank', kind: 'do' },
  { id: 'claim', kind: 'if' },
  { id: 'back', kind: 'end' },
];
const STEP_IDS = new Set(STEPS.map((s) => s.id));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const FIELDS = {
  lossAt: (v) => DATETIME.test(v) && !Number.isNaN(Date.parse(v.length === 10 ? `${v}T00:00` : v)),
  amount: (v) => /^\d{1,10}(\.\d{1,2})?$/.test(v),
  ack: (v) => /^\d{14}$/.test(v), // NCRP acknowledgement number
  bankRef: (v) => /^[A-Za-z0-9/-]{3,30}$/.test(v),
  mrmId: (v) => /^MR[A-Za-z0-9]{4,30}$/.test(v),
  // Letters, spaces and a few marks only: no digits, so an account or phone number cannot hide here.
  bank: (v) => /^[\p{L}\p{M} .&()'-]{2,60}$/u.test(v),
};

// Keeps only allowed fields with valid values. Anything unknown or malformed is dropped, not repaired.
export function sanitize(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, ok] of Object.entries(FIELDS)) {
    const v = typeof raw[k] === 'string' ? raw[k].trim() : '';
    if (v && ok(v)) out[k] = v;
  }
  if (Array.isArray(raw.utrs)) {
    const utrs = [...new Set(raw.utrs.filter((u) => typeof u === 'string' && /^(\d{12}|[A-Z]{4}[A-Z0-9]{12,18})$/.test(u)))];
    if (utrs.length) out.utrs = utrs.slice(0, 20);
  }
  if (raw.done && typeof raw.done === 'object') {
    const done = Object.fromEntries(Object.entries(raw.done).filter(([k, v]) => STEP_IDS.has(k) && typeof v === 'string' && DATE.test(v)));
    if (Object.keys(done).length) out.done = done;
  }
  return out;
}

export const parseCase = (json) => {
  try {
    return sanitize(JSON.parse(json));
  } catch {
    return {};
  }
};

export const isEmpty = (c) => Object.keys(sanitize(c)).length === 0;

// The first step not marked done. 'claim' only applies once money was held, so it is skipped
// until the person reaches it; it never blocks 'back'.
export function nextStep(c) {
  const done = sanitize(c).done || {};
  return STEPS.find((s) => !done[s.id] && s.kind !== 'if')?.id ?? null;
}

export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function markDone(c, step, on, when = today()) {
  const next = sanitize(c);
  const done = { ...(next.done || {}) };
  if (on) done[step] = when;
  else delete done[step];
  return sanitize({ ...next, done });
}

// Dates and numbers always in Latin digits, whatever the page language.
export const formatDate = (iso, lang) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00` : iso);
  const opts = { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' };
  if (iso.length > 10) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString(`${lang}-IN`, opts);
};
export const formatAmount = (v) => `Rs ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A payment's date (and time, if present) as read from a bank SMS, turned into the case's ISO form.
// Returns '' when the text has no date it can read with confidence.
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function toIso(text) {
  const t = String(text ?? '').toLowerCase();
  let y; let m; let d;
  let hit = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (hit) [, y, m, d] = hit.map(Number);
  else if ((hit = t.match(/\b(\d{1,2})[-/. ](\d{1,2}|[a-z]{3})[a-z]*[-/. ](\d{2,4})\b/))) {
    d = Number(hit[1]);
    m = MON[hit[2]] ?? Number(hit[2]);
    y = Number(hit[3]) + (hit[3].length === 2 ? 2000 : 0);
  } else return '';
  const date = new Date(y, m - 1, d);
  if (!m || date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '';
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const time = t.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s?([ap]\.?m\.?)?/);
  if (!time) return iso;
  let hh = Number(time[1]);
  if (time[3]) hh = (hh % 12) + (time[3].startsWith('p') ? 12 : 0);
  return hh < 24 && Number(time[2]) < 60 ? `${iso}T${String(hh).padStart(2, '0')}:${time[2]}` : iso;
}

// NCRP acknowledgement numbers are 14 digits. As reported (not yet confirmed on the live portal):
// portal complaints start with 2, complaints registered by calling 1930 start with 3.
export function ackInfo(input) {
  const v = String(input ?? '').replace(/[\s-]/g, '');
  if (!/^\d{14}$/.test(v)) return { ok: false, value: v, kind: null };
  return { ok: true, value: v, kind: v[0] === '2' ? 'portal' : v[0] === '3' ? 'call' : 'other' };
}
