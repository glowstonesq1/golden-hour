// The synthetic screenshot set: bank SMS and UPI receipts with known values, in English, Hindi and Marathi.
// Deterministic (seeded). Split by template: test templates were written with formats the extraction rules
// were not written for, and the rules are never tuned on them. All values are fake.
const NAMES = ['Ramesh Kumar', 'Priya Sharma', 'Anil Patil', 'Sunita Devi', 'Mohammed Irfan', 'Kavita Joshi'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const digits = (r, n) => Array.from({ length: n }, (_, i) => (i ? Math.floor(r() * 10) : 1 + Math.floor(r() * 9))).join('');

function values(r) {
  const day = String(1 + Math.floor(r() * 28)).padStart(2, '0');
  const mon = Math.floor(r() * 12);
  const name = pick(r, NAMES);
  return {
    amt: `${pick(r, ['1,499', '250', '12,000', '3,200', '899', '45,000', '6,750'])}.${pick(r, ['00', '50'])}`,
    a4: digits(r, 4),
    utr: digits(r, 12),
    dateMon: `${day}-${MONTHS[mon]}-26`,
    dateNum: `${day}/${String(mon + 1).padStart(2, '0')}/26`,
    time: `${String(Math.floor(r() * 12) + 1)}:${String(Math.floor(r() * 60)).padStart(2, '0')}`,
    name,
    nameUp: name.toUpperCase(),
    vpa: `${pick(r, ['rk', 'help', 'refund', 'pay', 'verify'])}${digits(r, 3)}@${pick(r, ['ybl', 'okaxis', 'paytm', 'ibl'])}`,
  };
}

// look: 'sms' (a message bubble) or 'receipt' (an app's payment card). fields: what a person would need.
const TEMPLATES = [
  { id: 'en-sbi', split: 'dev', lang: 'en', look: 'sms',
    text: (v) => `Dear Customer, your A/c XX${v.a4} is debited by Rs.${v.amt} on ${v.dateMon} trf to ${v.name} Refno ${v.utr}. If not done by you, call 1800111109 -SBI`,
    fields: (v) => ({ amount: v.amt, when: v.dateMon, utr: v.utr, payee: v.name }) },
  { id: 'en-icici', split: 'dev', lang: 'en', look: 'sms',
    text: (v) => `ICICI Bank Acct XX${v.a4} debited for Rs ${v.amt} on ${v.dateMon}; ${v.nameUp} credited. UPI:${v.utr}. Call 18002662 for dispute.`,
    fields: (v) => ({ amount: v.amt, when: v.dateMon, utr: v.utr, payee: v.nameUp }) },
  { id: 'en-kotak', split: 'dev', lang: 'en', look: 'sms',
    text: (v) => `Sent Rs.${v.amt} from Kotak Bank AC X${v.a4} to ${v.vpa} on ${v.dateNum}. UPI Ref ${v.utr}. Not you, kotak.com/fraud`,
    fields: (v) => ({ amount: v.amt, when: v.dateNum, utr: v.utr, payee: v.vpa }) },
  { id: 'hi-sbi', split: 'dev', lang: 'hi', look: 'sms',
    text: (v) => `आपके खाता XX${v.a4} से दिनांक ${v.dateMon} को रु.${v.amt} डेबिट किए गए। यूपीआई संदर्भ ${v.utr}। -एसबीआई`,
    fields: (v) => ({ amount: v.amt, when: v.dateMon, utr: v.utr }) },
  { id: 'mr-bom', split: 'dev', lang: 'mr', look: 'sms',
    text: (v) => `तुमच्या खात्यातून XX${v.a4} दिनांक ${v.dateMon} रोजी रु.${v.amt} वजा झाले. UPI संदर्भ ${v.utr}. प्राप्तकर्ता ${v.vpa}. -बँक ऑफ महाराष्ट्र`,
    fields: (v) => ({ amount: v.amt, when: v.dateMon, utr: v.utr, payee: v.vpa }) },

  { id: 'en-hdfc', split: 'test', lang: 'en', look: 'sms',
    text: (v) => `Rs.${v.amt} debited from a/c **${v.a4} on ${v.dateMon} to VPA ${v.vpa} (UPI Ref No ${v.utr}). Not you? Call 18002586161 to report -HDFC Bank`,
    fields: (v) => ({ amount: v.amt, when: v.dateMon, utr: v.utr, payee: v.vpa }) },
  { id: 'en-axis', split: 'test', lang: 'en', look: 'sms',
    text: (v) => `Debit INR ${v.amt}\nA/c no. XX${v.a4}\n${v.dateNum} ${v.time}\nUPI/P2A/${v.utr}/${v.nameUp}\nNot you? SMS BLOCKUPI to 919951860002\nAxis Bank`,
    fields: (v) => ({ amount: v.amt, when: v.dateNum, utr: v.utr, payee: v.nameUp }) },
  { id: 'en-receipt', split: 'test', lang: 'en', look: 'receipt',
    text: (v) => `Paid to\n${v.name}\n${v.vpa}\n₹${v.amt}\nTransaction Successful\n${v.dateMon}, ${v.time}\nUPI Ref. No: ${v.utr}\nDebited from XXXXXX${v.a4}`,
    fields: (v) => ({ amount: v.amt, when: v.dateMon, utr: v.utr, payee: v.vpa }) },
  { id: 'hi-receipt', split: 'test', lang: 'hi', look: 'receipt',
    text: (v) => `भुगतान सफल\n₹${v.amt}\n${v.vpa} को भेजे गए\nUPI संदर्भ संख्या: ${v.utr}\n${v.dateNum}`,
    fields: (v) => ({ amount: v.amt, when: v.dateNum, utr: v.utr, payee: v.vpa }) },
  { id: 'mr-receipt', split: 'test', lang: 'mr', look: 'receipt',
    text: (v) => `पेमेंट यशस्वी\n₹${v.amt}\n${v.vpa} ला पाठवले\nUPI संदर्भ क्र. ${v.utr}\n${v.dateNum}`,
    fields: (v) => ({ amount: v.amt, when: v.dateNum, utr: v.utr, payee: v.vpa }) },
];

export function ocrSet(fills = 3) {
  const out = [];
  for (const t of TEMPLATES) {
    const r = rng([...t.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 11));
    for (let i = 1; i <= fills; i++) {
      const v = values(r);
      out.push({ id: `${t.id}.${i}`, template: t.id, split: t.split, lang: t.lang, look: t.look, text: t.text(v), fields: t.fields(v) });
    }
  }
  return out;
}
