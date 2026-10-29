// Check v1: the rule layer. Text in, verdict out. No DOM, no network, no storage,
// so the page (app.js) and Node (tests, eval/run.mjs) run exactly the same code.
// It never says "safe": the three verdicts are 'likely', 'careful' and 'none' (no common scam signs found).

const MAX_CHARS = 10000; // same cap as shared messages; also bounds regex work on huge pastes

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'is.gd', 'cutt.ly', 't.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'ow.ly',
  'goo.gl', 's.id', 'rebrand.ly', 'v.gd', 'shorturl.gg', 'urlz.fr', 'wa.link', 'surl.li',
]);

// Registrable domains that brands named in scams really use. *.bank.in, *.gov.in and *.nic.in
// are restricted registries, so any host under them counts as official.
// shortcut: hand-kept list, grows as parser coverage grows (milestone 4); a miss only shows "careful".
const OFFICIAL = [
  'sbi.co.in', 'onlinesbi.sbi', 'sbi', 'hdfcbank.com', 'icicibank.com', 'axisbank.com', 'kotak.com',
  'pnbindia.in', 'canarabank.com', 'bankofbaroda.in', 'unionbankofindia.co.in', 'paytm.com',
  'phonepe.com', 'pay.google.com', 'amazon.in', 'amzn.in', 'amzn.to', 'flipkart.com', 'fkrt.it',
  'airtel.in', 'jio.com', 'jiomart.com', 'bsesdelhi.com', 'tatapower.com', 'tatapower-ddl.com',
  'mahadiscom.in', 'adanielectricity.com', 'irctc.co.in', 'bluedart.com', 'delhivery.com', 'dtdc.in',
  'fedex.com', 'dhl.com', 'swiggy.com', 'zomato.com', 'sbicard.com', 'hdfcbk.io', 'hdfclife.com',
  'icicidirect.com', 'amazonpay.in', 'jiohotstar.com', 'rbi.org.in', 'npci.org.in', 'mygov.in',
  'bank.in', 'gov.in', 'nic.in',
];
// Brand names are matched at the start or end of a host label ("onlinesbi-verify", "sbi-kyc"),
// never in the middle of a word ("orbit", "training"). "gov" must be a whole label part.
const BRAND_PART = /^(sbi|yono|hdfc|icici|axis|kotak|pnb|canara|baroda|unionbank|paytm|phonepe|gpay|googlepay|amazon|flipkart|indiapost|bluedart|delhivery|dtdc|fedex|dhl|airtel|jio|bses|tatapower|mahadiscom|mahavitaran|msedcl|adani|incometax|uidai|aadhaa?r|epfo|npci|rbi|irctc)|(sbi|yono|hdfc|icici|axis|kotak|pnb|canara|baroda|unionbank|paytm|phonepe|gpay|amazon|flipkart|indiapost|bluedart|delhivery|dtdc|fedex|airtel|bses|tatapower|mahadiscom|mahavitaran|msedcl|incometax|uidai|epfo|npci|irctc)$|^gov$/;
const hasBrand = (host) => host.split(/[.-]/).some((part) => BRAND_PART.test(part));

// Bare hosts (no scheme) need a lowercase TLD, so run-together sentences ("sent.To check") are not links.
const TLDS = 'com|in|net|org|co|io|ly|me|xyz|top|info|app|site|online|link|live|club|shop|gd|gl|at|cc|id|to|sbi|it|apk|icu|sbs|cfd|vip|buzz|cyou';
const BARE_HOST = new RegExp(`^[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.(${TLDS})(\\/\\S*)?$`);
const SCHEME_URL = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

const isOfficial = (host) => OFFICIAL.some((d) => host === d || host.endsWith(`.${d}`));

export function findLinks(text) {
  // Scheme links are found anywhere, even glued to text ("KYC:https://..."); bare hosts only as whole words.
  const found = [...text.matchAll(SCHEME_URL)].map((m) => m[0]);
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/^[(<"']+|[)>"'.,;:!?।]+$/g, '');
    if (/https?:\/\/|www\./i.test(token) || token.includes('@')) continue; // UPI IDs and emails are not links
    if (BARE_HOST.test(token)) found.push(token);
  }
  return found.map((raw) => {
    const rest = raw.replace(/[)>"'.,;:!?।]+$/, '').replace(/^https?:\/\//i, '');
    const authority = rest.split(/[/?#]/)[0];
    const at = authority.lastIndexOf('@'); // "https://onlinesbi.sbi@evil.xyz" really goes to evil.xyz
    const host = authority.slice(at + 1).split(':')[0].toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return { host, path: rest.slice(authority.length).split(/[?#]/)[0].toLowerCase(), userinfo: at >= 0 };
  }).filter((l) => l.host.includes('.'));
}

// Sign detectors. Hard signs alone make a message a likely scam.
// Only secrets count: a bare "pin" or "code" is usually a pin code or a referral code.
const SECRET = String.raw`(otp|one[- ]time password|upi pin|atm pin|mpin|cvv|password|verification code|\d+[- ]digit code)`;
// Each pattern is [regex, where the verb sits]. Negation counts only right next to the verb, so a scammer's
// "don't worry" or "don't tell anyone" elsewhere in the message does not cancel the request.
const OTP_ASK = [
  [new RegExp(String.raw`\b(share|send|tell|give|forward|provide|read out|confirm)\b[^.?!]{0,25}\b${SECRET}\b`, 'gi'), 'start'],
  [/\b(otp|upi pin|mpin|cvv)\b[^.?!]{0,30}\b(batao|bata do|batado|bhejo|bhej do|share karo|send karo|bolo)\b/gi, 'end'],
  [/(ओटीपी|ओ\.टी\.पी\.|otp|यूपीआई पिन|upi pin)[^।.?!]{0,30}(बताएं|बताइए|बताओ|बता दो|भेजें|भेजो|शेयर करें|सांगा|पाठवा)/gi, 'end'],
];
const NEG_BEFORE_START = /\b(not|never|don'?t|dont)\s+(\w+\s+)?$/i;
const NEG_BEFORE_END = /(?:^|\s)(mat|na|nahi|nahin|मत|न|नहीं)\s+\S+(\s\S+)?$/i;
const NEG_AFTER = /^\s*(नका|नये)/;
const DELIVERY_OTP = /\b(deliver(y|ed)?|delivery (agent|executive|partner))\b/i; // couriers really do ask for an OTP at the door

function asksForSecret(text) {
  for (const [re, verbAt] of OTP_ASK) {
    for (const m of text.matchAll(re)) {
      const end = m.index + m[0].length;
      const negated = verbAt === 'start'
        ? NEG_BEFORE_START.test(text.slice(Math.max(0, m.index - 20), m.index))
        : NEG_BEFORE_END.test(m[0]) || NEG_AFTER.test(text.slice(end, end + 10));
      if (!negated && !DELIVERY_OTP.test(text.slice(m.index, end + 50))) return true;
    }
  }
  return false;
}

const SIGNS = {
  screenShare: (t) => /\b(any ?desk|team ?viewer|quick ?support|rust ?desk|airdroid|ultra ?viewer|screen[- ]?shar(e|ing))\b/i.test(t),
  otpAsk: asksForSecret,
  collect: (t) =>
    /\b(approve|accept|enter)\b[^.?!]{0,40}\b(upi pin|pin|request)\b[^.?!]{0,30}\b(receive|get|claim|credit)/i.test(t) ||
    /\bscan\b[^.?!]{0,40}\bqr\b[^.?!]{0,30}\b(receive|claim)\b/i.test(t) ||
    /\b(receive|get|claim)\b[^.?!]{0,40}\b(scan|approve|enter)\b[^.?!]{0,30}\b(upi pin|pin|qr|request)\b/i.test(t),
  money: (t) =>
    /\b(pay|deposit|transfer|send|bhejo|bhej do|jama karo)\b[^.?!]{0,40}(rs\.?|₹|inr|rupees|rupaye|fee|charge|amount|money|paise|tax|fine)/i.test(t) ||
    /\b(registration|processing|security|customs|delivery|redelivery|clearance|verification)\s+(fee|charge|deposit|duty)/i.test(t) ||
    /(पैसे|रुपये|शुल्क|फीस)[^।.?!]{0,30}(भेज|जमा कर|भरा|पाठवा|दो|दें)/.test(t),
  urgency: (t) =>
    /\b(within \d+\s?(hours?|hrs?|minutes?|mins?)|in \d+\s?(hours?|hrs?)|immediately|urgent(ly)?|right now|today itself|tonight|last (chance|warning)|will be (blocked|suspended|deactivated|disconnected|closed|cancelled|cut)|legal action|arrest)/i.test(t) ||
    /(तुरंत|तुरन्त|आज रात|बंद कर दिया जाएगा|ताबडतोब|त्वरित|आज रात्री|लगेच|बंद होईल|खंडित केले जाईल)/.test(t),
};

const LINK_SIGNS = (links) => ({
  apk: links.some((l) => l.path.endsWith('.apk') || l.host.endsWith('.apk')),
  lookalike: links.some((l) => l.userinfo || /^\d+\.\d+\.\d+\.\d+$/.test(l.host) || (hasBrand(l.host) && !isOfficial(l.host))),
  shortLink: links.some((l) => SHORTENERS.has(l.host)),
  unknownLink: links.some((l) => !isOfficial(l.host) && !SHORTENERS.has(l.host)),
});

const HARD = ['apk', 'screenShare', 'otpAsk', 'collect', 'lookalike'];
const SOFT = ['unknownLink', 'shortLink', 'money', 'urgency'];

// Scam types, most specific first so ties go to the narrower type. Each pattern adds one point;
// an array of regexes is one pattern that needs all of them; a function is a detector from above.
const TYPES = {
  otp: [
    /\b(any ?desk|team ?viewer|quick ?support|rust ?desk|screen[- ]?shar)/i,
    asksForSecret,
    [/\b(scan|enter)\b/i, /\b(qr|upi pin)\b/i, /\b(receive|get|cashback|refund)\b/i],
  ],
  arrest: [
    [/\b(cbi|ncb|narcotics|enforcement directorate|crime branch|cyber ?crime|police|customs|trai|inspector)\b|सीबीआई|\bcbi\b|पुलिस|पोलीस/i,
      /\b(arrest|warrant|money laundering|drugs|illegal|seized|fir|case|investigation|video call|skype|disconnected)\b|गिरफ्तार|वारंट|अटक|केस/i],
    /\bdigital arrest\b|डिजिटल अरेस्ट/i,
    /money laundering|मनी लॉन्ड्रिंग/i,
  ],
  threat: [
    [/\b(video|photos?|pics?|recording|recorded)\b|वीडियो|व्हिडिओ|फोटो/i, /\b(viral|leak(ed)?|upload|contacts|family)\b|वायरल|व्हायरल|लीक/i],
    /\b(private|obscene|nude|intimate)\s+(video|photo|call)/i,
    [/\b(pay|send)\b/i, /\b(or|otherwise|else)\b/i, /\b(viral|leak|contacts|delete it)\b/i],
  ],
  family: [
    /\b(this is my new number|my phone (is )?(broke|broken|lost|damaged)|his phone is broken)\b|मेरा नया नंबर|माझा नवीन नंबर/i,
    [/\b(mum|mom|mummy|dad|papa|maa|beta|uncle|aunty|son|daughter)\b|मम्मी|पापा|(?:^|[\s,])(आई|बाबा)(?=[\s,।!?]|$)/i,
      /\b(accident|hospital|urgent(ly)?|need money|send|bhejo|operation)\b|अस्पताल|एक्सीडेंट|अपघात|तुरंत|पैसे/i],
    [/\b(accident|hospital|operation)\b|अस्पताल|एक्सीडेंट|अपघात/i, /\b(send|transfer|bhejo|money|rs)\b|₹|भेज|पैसे/i],
  ],
  invest: [
    /\b(guaranteed|assured|fixed)\s+(returns?|profit|income)\b|पक्का रिटर्न|गारंटी|हमखास परतावा/i,
    /\b(double your money|\d+\s?%\s*(every|per|daily|weekly|monthly|return|profit))/i,
    /\b(stock|share|trading|ipo|crypto|forex|bitcoin)\b[^.?!]{0,40}\b(tips|group|profit|vip|institutional|platform|discount)\b|शेयर बाजार|ट्रेडिंग/i,
    /\b(vip|premium)\s+(stock\s+)?(group|channel|tips)\b/i,
  ],
  job: [
    /\b(part[- ]?time|work from home|wfh|ghar baithe|daily (income|salary|earning)|per day|liking (youtube )?videos|rating task|prepaid task|commission for every)\b/i,
    /घर बैठे|पार्ट टाइम|रोज़ाना|रोजाना|कमाएं|घरबसल्या|घरी बसून|कमवा/,
    [/\b(hiring|selected|job|hr)\b/i, /\b(earn|salary|registration fee|telegram|whatsapp)\b/i],
  ],
  loan: [
    /\b(instant|quick|easy|urgent)\s+(personal\s+)?loan\b/i,
    /\b(no|without)\s+(cibil|credit score|documents)\b/i,
    [/\bloan\b/i, /\b(processing fee|approved in|send your aadhaar)\b/i],
    /(तुरंत|इंस्टेंट|त्वरित|झटपट)\s*(लोन|कर्ज)|लोन मंजूर|कर्ज मंजूर/,
  ],
  prize: [
    /\b(you have won|has won|you won|winner|lucky draw|lottery|jackpot|kbc|kaun banega crorepati)\b/i,
    /\breward points?\b[^.?!]{0,40}\b(expir|redeem)/i,
    /\b(tax refund|refund of rs)\b[^.?!]{0,40}\b(approved|pending|claim|receive)/i,
    /लॉटरी|इनाम|बक्षीस|जिंकले|जीत/,
  ],
  parcel: [
    [/\b(parcel|package|shipment|consignment|courier)\b|पार्सल|कूरियर/i,
      /\b(held|on hold|stuck|customs|incomplete address|address is incomplete|clearance|redelivery)\b|कस्टम|अडकले|रुका/i],
    /\b(customs|clearance|redelivery|re-delivery)\s+(fee|charge|duty)\b/i,
  ],
  bill: [
    [/\b(electricity|power|light|bijli)\b|बिजली|वीज/i, /\b(disconnect(ed)?|cut)\b|काट|खंडित/i, /\b(tonight|today|9[.:]?30|immediately)\b|आज रात/i],
    /\bbill (was |is )?not (been )?updated\b|बिल अपडेट नहीं|बिल अपडेट नाही/i,
    /\b(electricity|bijli) (officer|office|department)\b/i,
  ],
  kyc: [
    /\b(e-?)?kyc\b[^.?!]{0,40}\b(updat|expir|pending|suspend|block|verif|complet)|\b(update|complete|verify)\s+(your\s+)?(e-?)?kyc\b|केवाईसी/i,
    /\b(account|a\/c|yono|netbanking)\b[^.?!]{0,40}\b(blocked|block ho|suspended|deactivated|frozen|closure|closed)\b/i,
    /(खाता|खाते)[^।]{0,30}(बंद|ब्लॉक)/,
    /\bupdate (your )?pan\b/i,
  ],
};

const score = (text, patterns) =>
  patterns.reduce((n, p) => n + (Array.isArray(p) ? p.every((re) => re.test(text)) : typeof p === 'function' ? p(text) : p.test(text)), 0);

export function check(input) {
  const text = String(input ?? '').slice(0, MAX_CHARS).normalize('NFC').replace(/\s+/g, ' ').trim();
  const found = { ...LINK_SIGNS(findLinks(text)) };
  // Patterns stop at sentence ends, so dots inside amounts ("Rs. 1,499.00") must not count as one.
  const flat = text.replace(/(\d)[.,](?=\d)/g, '$1').replace(/\b(rs|inr|no|a\/c)\./gi, '$1');
  for (const [k, fn] of Object.entries(SIGNS)) found[k] = fn(flat);
  const signs = [...HARD, ...SOFT].filter((k) => found[k]);

  let type = null;
  let best = 0;
  for (const [k, patterns] of Object.entries(TYPES)) {
    const s = score(flat, patterns);
    if (s > best) [type, best] = [k, s];
  }
  if (!type && (found.otpAsk || found.screenShare || found.collect)) type = 'otp';

  const hard = HARD.some((k) => found[k]);
  const soft = SOFT.some((k) => found[k]);
  let verdict = 'none';
  if (hard || (type && soft)) verdict = 'likely';
  else if (type || found.shortLink || (found.money && found.urgency)) verdict = 'careful';
  return { verdict, type: verdict === 'none' ? null : type, signs };
}
