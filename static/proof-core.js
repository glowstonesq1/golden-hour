// Proof: turns what the person shares or picks (screenshot text, a WhatsApp chat export, a .zip of one)
// into small cards the person confirms one by one. Pure functions; nothing here touches storage or the DOM.
import { extractPayments, extractContacts, splitMessages } from './report-core.js';

// ---------- ZIP (WhatsApp exports): central directory, stored and deflated entries, .txt only ----------
const MAX_ENTRIES = 500;
const MAX_TEXT_BYTES = 5 * 1024 * 1024; // a chat export is text; more than this is not one (or is a zip bomb)

export function listZip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // End of central directory: the last record with this signature, within the 64 KB comment window.
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let at = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new Error('zip64 is not supported');
  if (count > MAX_ENTRIES) throw new Error('too many entries');
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > u8.length || dv.getUint32(at, true) !== 0x02014b50) throw new Error('corrupt central directory');
    const nameLen = dv.getUint16(at + 28, true);
    const entry = {
      flags: dv.getUint16(at + 8, true),
      method: dv.getUint16(at + 10, true),
      compSize: dv.getUint32(at + 20, true),
      size: dv.getUint32(at + 24, true),
      offset: dv.getUint32(at + 42, true),
      name: new TextDecoder().decode(u8.subarray(at + 46, at + 46 + nameLen)),
    };
    entries.push(entry);
    at += 46 + nameLen + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true);
  }
  return entries;
}

async function inflateRaw(bytes, limit) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const parts = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > limit) throw new Error('entry too large');
    parts.push(chunk);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

export async function readEntry(buf, e) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (e.flags & 1) throw new Error('encrypted entries are not supported');
  if (e.offset + 30 > u8.length || dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error('corrupt local header');
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  if (start + e.compSize > u8.length) throw new Error('truncated entry');
  const data = u8.subarray(start, start + e.compSize);
  if (e.method === 0) {
    if (data.length > MAX_TEXT_BYTES) throw new Error('entry too large');
    return data;
  }
  if (e.method === 8) return inflateRaw(data, MAX_TEXT_BYTES);
  throw new Error(`compression method ${e.method} is not supported`);
}

// The .txt files inside a zip; photos, voice notes and other media are skipped unread.
export async function zipTexts(buf) {
  const out = [];
  for (const e of listZip(buf)) {
    if (!/\.txt$/i.test(e.name) || e.name.endsWith('/')) continue;
    out.push({ name: e.name, text: new TextDecoder().decode(await readEntry(buf, e)) });
  }
  return out;
}

// ---------- WhatsApp chat export (.txt) ----------
// Android: "28/10/26, 2:15 pm - Name: text" (12 or 24 hour, often a U+202F narrow space before am/pm).
// iPhone: "[28/10/26, 2:15:30 PM] Name: text". Lines without a new header continue the message above.
const HEADER = /^\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?[\s  ]*([ap]\.?\s?m\.?)?\]?\s*(?:[-–]\s*)?(.*)$/i;

export function parseWhatsApp(text) {
  const messages = [];
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/^[‎‏﻿]+/, '');
    const m = line.match(HEADER);
    if (!m) {
      if (messages.length && line.trim()) messages[messages.length - 1].text += `\n${line}`;
      continue;
    }
    const [, d, mo, y, hh, mm, ap, rest] = m;
    const year = Number(y) + (y.length === 2 ? 2000 : 0);
    let hour = Number(hh);
    if (ap) hour = (hour % 12) + (/^p/i.test(ap) ? 12 : 0);
    const date = new Date(year, Number(mo) - 1, Number(d));
    if (date.getMonth() !== Number(mo) - 1 || hour > 23 || Number(mm) > 59) continue; // not a real header
    const colon = rest.indexOf(': ');
    messages.push({
      date: `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      time: `${String(hour).padStart(2, '0')}:${mm}`,
      sender: colon > 0 ? rest.slice(0, colon).trim() : '',
      text: colon > 0 ? rest.slice(colon + 2) : rest, // system lines ("Messages are end-to-end encrypted") have no sender
    });
  }
  return messages.filter((msg) => msg.sender && !/^<.*omitted>$|^null$/i.test(msg.text.trim()));
}

// ---------- Banks ----------
// The bank's name is the only free-text field the case keeps, so it is kept only as one of these names.
export const BANKS = [
  ['State Bank of India', /\bSBI\b|state bank of india|एसबीआई|स्टेट बँक/i],
  ['HDFC Bank', /\bHDFC\b/i],
  ['ICICI Bank', /\bICICI\b/i],
  ['Axis Bank', /\bAxis\b/i],
  ['Kotak Mahindra Bank', /\bKotak\b/i],
  ['Punjab National Bank', /\bPNB\b|punjab national/i],
  ['Bank of Baroda', /\bBoB\b|bank of baroda/i],
  ['Canara Bank', /\bcanara\b/i],
  ['Union Bank of India', /union bank/i],
  ['Bank of India', /^bank of india$|\bBOI\b/i],
  ['Indian Bank', /^indian bank$/i],
  ['Central Bank of India', /central bank of india/i],
  ['Bank of Maharashtra', /bank of maharashtra|बँक ऑफ महाराष्ट्र/i],
  ['IndusInd Bank', /indusind/i],
  ['Yes Bank', /\byes bank\b/i],
  ['IDFC FIRST Bank', /\bIDFC\b/i],
];
export const canonicalBank = (text) => BANKS.find(([, re]) => re.test(String(text ?? '').trim()))?.[0] || '';

// ---------- Cards ----------
const clip = (s, around) => {
  const t = s.replace(/\s+/g, ' ').trim();
  const i = Math.max(0, t.indexOf(around));
  return t.length <= 160 ? t : `${i > 60 ? '…' : ''}${t.slice(Math.max(0, i - 60), i + 100)}${i + 100 < t.length ? '…' : ''}`;
};

// One card per value, each with the line it came from. Payment fields share a group number so the
// letter can rebuild rows; scammer contacts and the bank stand alone. Values are copied word for word.
export function findCards(texts, ownMobile = '') {
  const cards = [];
  let group = 0;
  const seen = new Set();
  const add = (kind, value, source, g = null, extra = {}) => {
    const key = `${kind}|${value}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    cards.push({ id: `c${cards.length}`, kind, value, source: clip(source, value), group: g, state: 'new', ...extra });
  };
  for (const text of texts) {
    for (const p of extractPayments(text)) {
      const g = group++;
      add('amount', p.amount, p.source, g);
      add('when', p.when, p.source, g);
      add('utr', p.utr, p.source, g);
      add('payee', p.to, p.source, g, { mode: p.mode, from: p.from });
      add('bank', canonicalBank(p.source.match(/-\s*([A-Za-z][A-Za-z ]{1,30})\s*$/)?.[1] || '') ||
        BANKS.find(([, re]) => re.test(p.source))?.[0], p.source);
    }
    // Scammer contacts come from chats and other non-payment text: a bank alert's own helpline or
    // "SMS BLOCK" number is not the scammer, and a paid UPI ID already has its card.
    const paid = new Set(cards.filter((c) => c.kind === 'payee').map((c) => c.value));
    for (const msg of splitMessages(text).filter((m) => !extractPayments(m).length)) {
      for (const c of extractContacts(msg, ownMobile)) if (!paid.has(c)) add('scammer', c, msg);
    }
  }
  return cards;
}
