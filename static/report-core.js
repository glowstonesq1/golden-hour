// Report maker core: pulls payment and scammer details out of the person's own words and messages,
// and lays out the complaint. Pure functions, no DOM, so Node tests run exactly what the page runs.
import { findLinks } from './rules.js';

const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const first = (re, s) => s.match(re)?.[1] ?? '';

// Every value taken automatically must appear word for word in the person's own text.
export const verbatim = (value, source) => !!norm(value) && norm(source).includes(norm(value));

// A payment amount, never a balance or a limit ("Avl Bal Rs 12,000.00" is not money lost).
const CURRENCY_AMOUNT = /(?:\b(?:rs|inr)\.?|₹|रु\.?|रू\.?)\s*([\d,]+(?:\.\d{1,2})?)/gi;
const NOT_PAID = /(?:bal(?:ance)?|avl|available|limit|lmt|शेष|शिल्लक)[^\d]{0,12}$/i;
const DEBIT_AMOUNT = /\b(?:debited|debit|sent|paid|spent|withdrawn|transferred|deducted)\s+(?:by|for|with|of)?\s*(?:(?:rs|inr)\.?\s*|₹\s*)?(\d[\d,]*(?:\.\d{1,2})?)\b/i;
function paidAmount(m) {
  const near = first(DEBIT_AMOUNT, m);
  if (near) return near;
  for (const a of m.matchAll(CURRENCY_AMOUNT)) if (!NOT_PAID.test(m.slice(Math.max(0, a.index - 25), a.index))) return a[1];
  return '';
}

export function splitMessages(text) {
  const t = String(text ?? '').replace(/\r/g, '').trim();
  if (!t) return [];
  if (/\n\s*\n/.test(t)) return t.split(/\n\s*\n/).map(norm).filter(Boolean);
  // No blank lines: a multi-line SMS ("Sent Rs.500 / From A/C / To ... / Ref ...") stays together,
  // and a new message starts only at a line that carries a payment amount.
  const out = [];
  for (const line of t.split('\n').map(norm).filter(Boolean)) {
    if (!out.length || paidAmount(line)) out.push(line);
    else out[out.length - 1] += ` ${line}`;
  }
  return out;
}

const DATE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[-/.](?:\d{1,2}|[A-Za-z]{3,9})[-/.]\d{2,4}|\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{2,4})\b/i;
// A UTR is read only after a reference label, so an account or helpline number is never taken for one.
// UPI and IMPS references are 12 digits; NEFT and RTGS UTRs start with the bank's 4-letter code.
const UTR = /(?:\b(?:ref(?:erence)?|refno|utr|rrn|txn|transaction|upi)\b|संदर्भ)(?:\s*(?:no|id|ref)\b\.?)*\s*[:.#-]?\s*(\d{12}|[A-Z]{4}[A-Z0-9]{12,18})\b/i;
// A UPI ID has no dot and lowercase domain after the handle (okaxis, ybl); an email address does.
const UPI_ID = /[\w.-]{2,}@[a-zA-Z][a-zA-Z0-9]+(?![\w-]*\.[a-z]{2,})/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[a-z][\w-]*)*\.[a-z]{2,}\b/g;
const PAYEE = /\b(?:trf|transfer(?:red)?|paid|sent)\s+to\s+([a-z][\w .&-]{1,40}?)(?=\s+(?:on|ref|refno|upi|via|from)\b|[.;(]|$)/i;
// HDFC-style multi-line alerts put the payee on its own "To NAME" line, in capitals.
const PAYEE_LINE = /(?:^|\s)[Tt]o\s+([A-Z][A-Z .&-]{1,40}?)(?=\s+(?:[Oo]n|[Rr]ef|UPI)\b)/;
const ACCOUNT = /(?:\b(?:a\/c|ac|acct|account)|खाता|खाते|खात्यातून)(?:\s*no\.?)?\s*[:.]?\s*([x*]+\d{3,6}|\d{9,18})\b/i;
const DEBIT = /\b(debited|debit|dr|sent|paid|withdrawn|spent|transferred|deducted)\b|डेबिट|भेजे|पाठवले|वजा/i;
const MODE = /\b(upi|imps|neft|rtgs|card|wallet)\b/i;
const PHONE = /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g;

// Clock times only: "2026-10-28:14:22:11" must not read as 28:14.
function clock(m) {
  for (const t of m.matchAll(/(\d{1,2}):(\d{2})(?::\d{2})?(?:\s?[ap]m)?/gi)) {
    if (Number(t[1]) < 24 && !/[\d:]/.test(m[t.index - 1] ?? ' ')) return t[0];
  }
  return '';
}

// One row per payment message that reads as money leaving the account. Credits are left out.
export function extractPayments(text) {
  const out = [];
  for (const m of splitMessages(text)) {
    const amount = paidAmount(m);
    if (!amount || !DEBIT.test(m)) continue;
    const account = first(ACCOUNT, m);
    const payee = first(PAYEE, m) || first(PAYEE_LINE, m);
    const row = {
      when: [first(DATE, m), clock(m)].filter((x) => verbatim(x, m)).join(' '),
      amount,
      mode: (first(MODE, m) || (m.match(UPI_ID) ? 'UPI' : '')).toUpperCase(),
      utr: first(UTR, m),
      to: m.match(UPI_ID)?.[0] || payee.trim(),
      from: account ? `XX${account.slice(-4)}` : '', // never keep the person's full account number
    };
    if (account && row.utr === account) row.utr = '';
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
// The person's own mobile number, and a UPI ID made from it, are left out.
export function extractContacts(text, ownMobile = '') {
  const src = String(text ?? '');
  const digits = (s) => s.replace(/\D/g, '').slice(-10);
  const own = digits(ownMobile);
  const found = [
    ...(src.match(PHONE) || []).filter((p) => digits(p) !== own),
    ...(src.match(UPI_ID) || []).filter((u) => !own || digits(u.split('@')[0]) !== own),
    ...(src.match(EMAIL) || []),
  ];
  for (const raw of src.split(/\s+/)) {
    if (raw.includes('@') || !findLinks(raw).length) continue;
    found.push((raw.match(/(?:https?:\/\/|www\.)\S+/i)?.[0] ?? raw).replace(/[)>"'.,;:!?।]+$/, ''));
  }
  return [...new Set(found.map((x) => x.trim()))].filter((x) => x && verbatim(x, src));
}

// Numbers, IDs, links and amount words in an AI summary that are not in the person's own text. Any hit
// means the summary invented a detail, so the page throws it away. Whole tokens are compared, so
// "Rs 1,000" does not pass because the source says "Rs 10,000". Plain words cannot be checked this way.
const SCALE = /\b(lakhs?|lacs?|crores?|thousands?|hundreds?|millions?|billions?)\b|लाख|करोड़|करोड|हज़ार|हजार|कोटी/gi;
const ID_RE = /[\w.+-]+@[\w.-]*\w/g;
function detailTokens(text) {
  const t = norm(text).toLowerCase();
  const ids = [...(t.match(ID_RE) || []), ...findLinks(t).map((l) => `${l.host}${l.path}`.replace(/\/$/, ''))];
  const rest = t.replace(ID_RE, ' ').replace(/(?:https?:\/\/|www\.)\S+/g, ' ');
  const numbers = (rest.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => String(Number(n.replace(/,/g, ''))));
  return { ids, numbers, scales: (t.match(SCALE) || []).map((w) => w.replace(/s$/, '')) };
}
export function unsupportedDetails(summary, source) {
  const src = detailTokens(source);
  const sum = detailTokens(summary);
  return [
    ...sum.ids.filter((x) => !src.ids.includes(x)),
    ...sum.numbers.filter((x) => !src.numbers.includes(x)),
    ...sum.scales.filter((x) => !src.scales.includes(x)),
  ];
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
