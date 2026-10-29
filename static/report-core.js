// Report maker core: pulls payment and scammer details out of the person's own words and messages,
// and lays out the complaint. Pure functions, no DOM, so Node tests run exactly what the page runs.
import { findLinks } from './rules.js';

const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

// Every value taken automatically must appear word for word in the person's own text.
export const verbatim = (value, source) => !!norm(value) && norm(source).includes(norm(value));

export function splitMessages(text) {
  const t = String(text ?? '').replace(/\r/g, '').trim();
  if (!t) return [];
  // Pasted SMS are usually separated by blank lines; without any, each line is one message.
  return (/\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split('\n')).map(norm).filter(Boolean);
}

const AMOUNT = /(?:rs\.?|inr|₹|रु\.?|रू\.?)\s*([\d,]+(?:\.\d{1,2})?)/i;
const DATE = /\b(\d{1,2}[-/.](?:\d{1,2}|[A-Za-z]{3,9})[-/.]\d{2,4}|\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{2,4})\b/i;
const TIME = /\b(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?)\b/i;
// UPI and IMPS references are 12 digits; NEFT and RTGS UTRs start with the bank's 4-letter code.
const UTR = /\b(\d{12}|[A-Z]{4}[A-Z0-9]{12,18})\b/;
// A UPI ID has no dot after the @ (okaxis, ybl); an email address does.
const UPI_ID = /[\w.-]{2,}@[a-z][a-z0-9]+(?![\w.-]*\.[a-z])/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
const PAYEE = /\b(?:trf|transfer(?:red)?|paid|sent)\s+to\s+([A-Za-z][\w .&-]{1,40}?)(?=\s+(?:on|ref|refno|upi|via|from)\b|[.;(]|$)/i;
const ACCOUNT = /(?:\b(?:a\/c|ac|acct|account)|खाता|खाते|खात्यातून)(?:\s*no\.?)?\s*[:.]?\s*([x*]+\d{3,6}|\d{9,18})\b/i;
const DEBIT = /\b(debited|debit|sent|paid|withdrawn|spent|transferred|deducted)\b|डेबिट|भेजे|पाठवले|वजा/i;
const MODE = /\b(upi|imps|neft|rtgs|card|wallet)\b/i;
const PHONE = /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g;

const first = (re, s) => s.match(re)?.[1] ?? '';

// One row per payment message that reads as money leaving the account. Credits are left out.
export function extractPayments(text) {
  const out = [];
  for (const m of splitMessages(text)) {
    const amount = first(AMOUNT, m);
    if (!amount || !DEBIT.test(m)) continue;
    const to = m.match(UPI_ID)?.[0] || first(PAYEE, m).trim();
    const account = first(ACCOUNT, m);
    const row = {
      when: [first(DATE, m), first(TIME, m)].filter((x) => verbatim(x, m)).join(' '),
      amount,
      mode: (first(MODE, m) || (m.match(UPI_ID) ? 'UPI' : '')).toUpperCase(),
      utr: first(UTR, m),
      to,
      from: account ? `XX${account.slice(-4)}` : '', // never keep the person's full account number
    };
    for (const k of ['amount', 'utr', 'to']) if (row[k] && !verbatim(row[k], m)) row[k] = '';
    out.push(row);
  }
  return out;
}

export const amountValue = (s) => {
  const n = Number(String(s ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(n) ? n : 0;
};
export const formatRs = (n) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const totalLost = (payments) => payments.reduce((sum, p) => sum + amountValue(p.amount), 0);

// Scammer's contact points from the story: phone numbers, UPI IDs, emails and links, exactly as written.
export function extractContacts(text, ownMobile = '') {
  const src = String(text ?? '');
  const digits = (s) => s.replace(/\D/g, '').slice(-10);
  const own = digits(ownMobile);
  const found = [
    ...(src.match(PHONE) || []).filter((p) => digits(p) !== own),
    ...(src.match(UPI_ID) || []),
    ...(src.match(EMAIL) || []),
  ];
  for (const raw of src.split(/\s+/)) {
    if (raw.includes('@') || !findLinks(raw).length) continue;
    found.push((raw.match(/(?:https?:\/\/|www\.)\S+/i)?.[0] ?? raw).replace(/[)>"'.,;:!?।]+$/, ''));
  }
  return [...new Set(found.map((x) => x.trim()))].filter((x) => x && verbatim(x, src));
}

// Numbers, IDs and links in an AI summary that are not in the person's own text. Any hit means the
// summary invented a detail, so the page throws it away. Words cannot be checked this way; numbers can.
export function unsupportedDetails(summary, source) {
  const clean = (s) => s.toLowerCase().replace(/(\d),(?=\d)/g, '$1');
  const src = clean(norm(source));
  const tokens = String(summary ?? '').match(/[\w.+-]+@[\w.-]+|(?:https?:\/\/|www\.)\S+|\d[\d,.:/-]*\d|\d/g) || [];
  return tokens.map((t) => clean(t).replace(/[.,;:]+$/, '')).filter((t) => !src.includes(t));
}

const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// The complaint as a plain structure, rendered both as the on-screen letter and as copyable text.
export function buildReport(d, t) {
  const blank = t.blank;
  const v = (x) => norm(x) || blank;
  const total = totalLost(d.payments);
  const sections = [
    { title: t.s1, rows: [[t.f.name, v(d.name)], [t.f.mobile, v(d.mobile)], [t.f.email, v(d.email)], [t.f.address, v(d.address)], [t.f.bank, v(d.bank)]] },
    { title: t.s2, quote: norm(d.story) || blank },
  ];
  if (norm(d.summary)) sections.push({ title: t.s2ai, paras: [norm(d.summary)] });
  sections.push({
    title: t.s3,
    table: {
      head: [t.col.when, t.col.amount, t.col.mode, t.col.utr, t.col.to, t.col.from],
      rows: d.payments.map((p) => [p.when, p.amount && `Rs ${p.amount}`, p.mode, p.utr, p.to, p.from].map((x) => norm(x) || '-')),
    },
    paras: d.payments.length ? [fill(t.total, { amount: formatRs(total) })] : [t.noPaymentsDoc],
  });
  sections.push({
    title: t.s4,
    rows: [[t.fraudType, v(d.typeName)], [t.contactedBy, v(d.channel)], [t.firstContact, v(d.firstContact)]],
    items: d.contacts.length ? d.contacts : [blank],
    itemsTitle: t.contactsTitle,
  });
  sections.push({ title: t.s5, paras: [d.recipient === 'bank' ? t.requestBank : t.requestPolice] });
  sections.push({ title: t.s6, items: t.docs, checklist: true });
  return {
    to: [t.to, d.recipient === 'bank' ? `${t.toBank}, ${v(d.bank)}` : t.toPolice, blank],
    date: `${t.dateLabel}: ${d.date}`,
    subject: total ? fill(t.subject, { amount: formatRs(total) }) : t.subjectNoAmount,
    salutation: t.salutation,
    intro: [fill(t.intro, { name: v(d.name), mobile: v(d.mobile) }), ...(norm(d.ack) ? [fill(t.introAck, { ack: norm(d.ack) })] : [])],
    sections,
    declaration: t.declaration,
    sign: [[t.signature, ''], [t.f.name, v(d.name)], [t.dateLabel, d.date], [t.place, blank]],
    footer: t.footer,
  };
}

export function reportText(r) {
  const out = [...r.to, '', r.date, '', r.subject, '', r.salutation, '', ...r.intro, ''];
  r.sections.forEach((s, i) => {
    out.push(`${i + 1}. ${s.title}`);
    for (const [k, val] of s.rows || []) out.push(`${k}: ${val}`);
    if (s.quote) out.push(`"${s.quote}"`);
    if (s.table) {
      s.table.rows.forEach((row, n) => out.push(`${n + 1}) ${row.map((c, j) => `${s.table.head[j]}: ${c}`).join('; ')}`));
    }
    for (const p of s.paras || []) out.push(p);
    if (s.itemsTitle) out.push(`${s.itemsTitle}:`);
    for (const it of s.items || []) out.push(`${s.checklist ? '[ ]' : '-'} ${it}`);
    out.push('');
  });
  out.push(r.declaration, '', ...r.sign.map(([k, val]) => `${k}: ${val}`), '', r.footer);
  return out.join('\n');
}
