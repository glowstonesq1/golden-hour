// Generates the synthetic scam and genuine-message sets from hand-written templates.
// Deterministic (seeded), so the committed .jsonl files are frozen and a test checks they still match.
// Every value is fake: phone numbers, UPI IDs, links and reference numbers are random and valid only in format.
// Splits are by template, not by message: a test template's wording never appears in dev.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const FILLS_PER_TEMPLATE = 4;

function rng(seed) {
  // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
const digits = (r, n) => Array.from({ length: n }, (_, i) => (i === 0 ? 1 + Math.floor(r() * 9) : Math.floor(r() * 10))).join('');
const word = (r, n) => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(r() * 31)]).join('');

const NAMES = ['Ramesh Kumar', 'Priya Sharma', 'Anil Patil', 'Sunita Devi', 'Mohammed Irfan', 'Kavita Joshi', 'Suresh Nair', 'Pooja Verma'];
const HANDLES = ['okaxis', 'ybl', 'paytm', 'oksbi', 'ibl', 'okhdfcbank', 'axl'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ITEMS = ['Mixer Grinder', 'Bluetooth Earphones', 'Kurta Set', 'Phone Cover', 'School Bag'];

const SLOTS = {
  amt: (r) => `${pick(r, ['1,499', '250', '12,000', '75', '3,200', '899', '45,000', '6,750'])}.${pick(r, ['00', '50'])}`,
  amt2: (r) => `${digits(r, 2)},${digits(r, 3)}.${digits(r, 2)}`,
  small_amt: (r) => pick(r, ['25', '49', '99', '150', '299', '1,000', '2,500']),
  a4: (r) => digits(r, 4),
  utr: (r) => digits(r, 12),
  otp: (r) => digits(r, 6),
  date: (r) => `${String(1 + Math.floor(r() * 28)).padStart(2, '0')}-${pick(r, MONTHS)}-26`,
  time: (r) => `${String(Math.floor(r() * 24)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}`,
  name: (r) => pick(r, NAMES),
  vpa: (r) => `${pick(r, ['rk', 'help', 'refund', 'pay', 'sunil', 'raj', 'verify'])}${digits(r, 3)}@${pick(r, HANDLES)}`,
  phone: (r) => `${pick(r, ['6', '7', '8', '9'])}${digits(r, 9).slice(1)}${Math.floor(r() * 10)}`,
  order: (r) => `${digits(r, 3)}-${digits(r, 7)}-${digits(r, 7)}`,
  awb: (r) => `${pick(r, ['EK', 'RM', 'CP'])}${digits(r, 9)}IN`,
  code: (r) => word(r, 7),
  cons: (r) => digits(r, 12),
  pnr: (r) => digits(r, 10),
  item: (r) => pick(r, ITEMS),
  short: (r) => `${pick(r, ['https://bit.ly/', 'https://tinyurl.com/', 'cutt.ly/', 'https://is.gd/'])}${word(r, 6)}`,
  unknown_link: (r) => `https://${pick(r, ['quick-help', 'claim-now', 'secure-verify', 'my-portal', 'fastdesk'])}${digits(r, 2)}.${pick(r, ['xyz', 'top', 'online', 'site', 'in'])}/${word(r, 5)}`,
  lookalike_sbi: (r) => `https://${pick(r, ['sbi-kyc-update.com', 'onlinesbi-verify.in', 'sbi-rewards.top', 'yono-sbi.online'])}/${word(r, 5)}`,
  lookalike_hdfc: (r) => `https://${pick(r, ['hdfc-netbanking.in', 'hdfcbank-kyc.xyz', 'hdfc-secure.site'])}/${word(r, 5)}`,
  lookalike_post: (r) => `https://${pick(r, ['indiapost-track.top', 'indiapost-gov.in', 'indiapost.delivery-help.xyz'])}/${word(r, 5)}`,
  apk: (r) => `http://${pick(r, ['bill-update', 'quickloan', 'yono-update', 'power-pay'])}${digits(r, 2)}.in/${pick(r, ['App', 'Update', 'Pay'])}.apk`,
};

const S = (id, split, type, lang, text) => ({ id, split, label: 'scam', type, lang, text });
const G = (id, split, lang, text) => ({ id, split, label: 'genuine', type: null, lang, text });

// Scam templates: four per type, two dev and two test. Some test wording deliberately differs from dev.
export const TEMPLATES = [
  S('kyc-1', 'dev', 'kyc', 'en', 'Dear Customer, your SBI YONO account will be blocked today. Please update your PAN card immediately: {lookalike_sbi}'),
  S('kyc-2', 'dev', 'kyc', 'hi', 'आपका बैंक खाता आज बंद कर दिया जाएगा क्योंकि आपका केवाईसी अपडेट नहीं है। तुरंत अपडेट करें: {short}'),
  S('kyc-3', 'test', 'kyc', 'en', 'HDFC Bank: Your KYC has expired and NetBanking is suspended. Complete e-KYC in 24 hrs to avoid account closure {lookalike_hdfc}'),
  S('kyc-4', 'test', 'kyc', 'hinglish', 'Dear user aapka account block ho jayega, KYC update karne ke liye is number par call karo {phone}'),

  S('arrest-1', 'dev', 'arrest', 'en', 'This is Inspector {name} from Mumbai Cyber Crime Branch. A parcel in your name with illegal drugs was seized by customs. Join the video call on Skype now or an arrest warrant will be issued.'),
  S('arrest-2', 'dev', 'arrest', 'en', 'TRAI notice: your mobile number will be disconnected in 2 hours due to illegal activity. Press 9 to talk to the CBI officer.'),
  S('arrest-3', 'test', 'arrest', 'hi', 'CBI ने आपके आधार से जुड़े मनी लॉन्ड्रिंग केस में गिरफ्तारी वारंट जारी किया है। वीडियो कॉल पर जुड़ें और किसी को न बताएं।'),
  S('arrest-4', 'test', 'arrest', 'en', 'Sir your name has come in a money laundering case. You are under digital arrest. Do not disconnect this call and transfer Rs {amt} to the RBI verification account {vpa}.'),

  S('parcel-1', 'dev', 'parcel', 'en', 'India Post: Your package is held at our warehouse due to incomplete address. Update within 24 hours: {lookalike_post}'),
  S('parcel-2', 'dev', 'parcel', 'en', 'FedEx: Your shipment from Dubai is held at customs. Pay clearance fee Rs {small_amt} to release it: {short}'),
  S('parcel-3', 'test', 'parcel', 'en', 'Your parcel could not be delivered because the address is incomplete. Please confirm your details and pay Rs 25 redelivery charge here {unknown_link}'),
  S('parcel-4', 'test', 'parcel', 'mr', 'तुमचे पार्सल कस्टम्समध्ये अडकले आहे. सोडवण्यासाठी शुल्क Rs {small_amt} भरा: {short}'),

  S('bill-1', 'dev', 'bill', 'en', 'Dear Consumer, your electricity power will be disconnected tonight at 9.30 pm because your previous month bill was not updated. Please immediately contact our electricity officer {phone}'),
  S('bill-2', 'dev', 'bill', 'hi', 'प्रिय ग्राहक, आपका बिजली कनेक्शन आज रात काट दिया जाएगा। बिल अपडेट नहीं हुआ है। तुरंत इस नंबर पर संपर्क करें {phone}'),
  S('bill-3', 'test', 'bill', 'mr', 'प्रिय ग्राहक, आपले वीज कनेक्शन आज रात्री 9.30 वाजता खंडित केले जाईल. मागील बिल अपडेट नाही. त्वरित संपर्क करा {phone}'),
  S('bill-4', 'test', 'bill', 'en', 'MSEDCL: Dear customer your light connection will be cut today. Download the app to pay pending amount {apk}'),

  S('job-1', 'dev', 'job', 'en', 'Hello, I am {name} from HR. We are hiring part-time workers. Earn Rs 3000 to 8000 per day by liking YouTube videos. Contact on Telegram {short}'),
  S('job-2', 'dev', 'job', 'hi', 'घर बैठे कमाएं ₹5000 रोज़ाना। सिर्फ 10 मिनट का काम। अभी जुड़ें: {unknown_link}'),
  S('job-3', 'test', 'job', 'en', 'Congratulations! You are selected for work from home online job. Daily salary Rs 2500. Pay registration fee Rs 499 to start: {vpa}'),
  S('job-4', 'test', 'job', 'en', 'Hi dear, simple rating task, you get commission for every review. First prepaid task is Rs 1000 and you get Rs 1300 back. Message on WhatsApp {phone}'),

  S('invest-1', 'dev', 'invest', 'en', 'Join our VIP stock tips group and get guaranteed returns of 30% every month. SEBI registered experts. Click {short}'),
  S('invest-2', 'dev', 'invest', 'en', 'Institutional trading account offer: buy IPO shares at a discount and earn assured profit. Download our app {unknown_link}'),
  S('invest-3', 'test', 'invest', 'en', 'Double your money in 15 days with our crypto trading platform. Minimum investment Rs 10,000. Contact {phone}'),
  S('invest-4', 'test', 'invest', 'hi', 'शेयर बाजार के टिप्स से रोज़ 5% मुनाफा, पक्का रिटर्न। हमारे व्हाट्सएप ग्रुप से जुड़ें {short}'),

  S('loan-1', 'dev', 'loan', 'en', 'Instant personal loan up to Rs 5 lakh approved in 5 minutes. No CIBIL check, no documents. Download now {apk}'),
  S('loan-2', 'dev', 'loan', 'en', 'Dear customer, your pre-approved loan of Rs {amt} is ready. Pay processing fee Rs 1,999 to get it credited today: {vpa}'),
  S('loan-3', 'test', 'loan', 'hi', 'तुरंत लोन पाएं बिना किसी दस्तावेज़ के। लोन मंजूर, अभी ऐप डाउनलोड करें {unknown_link}'),
  S('loan-4', 'test', 'loan', 'en', 'Urgent loan available without credit score, low interest. Send your Aadhaar and PAN on WhatsApp {phone}'),

  S('prize-1', 'dev', 'prize', 'en', 'Congratulations! Your number has won Rs 25,00,000 in the KBC lucky draw. To claim, contact our manager {phone} and pay tax first.'),
  S('prize-2', 'dev', 'prize', 'en', 'Dear customer, your SBI reward points worth Rs 7,250 expire today. Redeem now: {lookalike_sbi}'),
  S('prize-3', 'test', 'prize', 'en', 'Income Tax Refund of Rs {amt} approved. Verify your account details to receive it {unknown_link}'),
  S('prize-4', 'test', 'prize', 'mr', 'अभिनंदन! तुम्ही लॉटरीमध्ये ₹10,00,000 जिंकले आहात. बक्षीस मिळवण्यासाठी प्रक्रिया शुल्क भरा {vpa}'),

  S('otp-1', 'dev', 'otp', 'en', "Sir I am calling from your bank's card department. To stop the fraud transaction please share the OTP you just received."),
  S('otp-2', 'dev', 'otp', 'en', 'To receive your cashback of Rs {small_amt}, scan this QR code and enter your UPI PIN.'),
  S('otp-3', 'test', 'otp', 'en', 'For your refund our executive will help you. Please install AnyDesk from Play Store and tell us the 9 digit code.'),
  S('otp-4', 'test', 'otp', 'hinglish', 'Aapke account mein galti se paise aa gaye hain, jo OTP aaya hai woh batao taaki hum wapas le sakein'),

  S('family-1', 'dev', 'family', 'en', 'Hi Mum, this is my new number, my phone broke. Can you send Rs {small_amt} urgently? I will explain later.'),
  S('family-2', 'dev', 'family', 'hinglish', 'Papa main hospital mein hoon, accident ho gaya, jaldi {small_amt} rupaye is UPI par bhejo {vpa}'),
  S('family-3', 'test', 'family', 'hi', 'मम्मी, यह मेरा नया नंबर है। मुझे तुरंत पैसे चाहिए, इस नंबर पर भेज दो {vpa}'),
  S('family-4', 'test', 'family', 'en', "Uncle, your son had an accident and is in the hospital. Transfer Rs 50,000 for the operation now to {vpa}. Don't call him, his phone is broken."),

  S('threat-1', 'dev', 'threat', 'en', 'I have your private video from the call. Pay Rs 20,000 or I will send it to all your contacts and make it viral.'),
  S('threat-2', 'dev', 'threat', 'hi', 'आपका वीडियो हमारे पास है। पैसे भेजो वरना यूट्यूब पर वायरल कर देंगे।'),
  S('threat-3', 'test', 'threat', 'en', 'Your obscene video is with the cyber police. Pay the fine to delete it, otherwise case will be filed.'),
  S('threat-4', 'test', 'threat', 'en', 'We recorded you. Send money to {vpa} within 24 hours or your photos will be leaked to your family.'),

  // Genuine messages, modelled on public formats of bank, UPI, OTP, delivery and bill messages.
  G('bank-1', 'dev', 'en', 'Dear Customer, your A/c XX{a4} is debited by Rs.{amt} on {date} trf to {name} Refno {utr}. If not done by you, call 1800111109 -SBI'),
  G('bank-2', 'test', 'en', 'Rs.{amt} debited from a/c **{a4} on {date} to VPA {vpa} (UPI Ref No {utr}). Not you? Call 18002586161 to report -HDFC Bank'),
  G('bank-3', 'dev', 'en', 'ICICI Bank Acct XX{a4} debited for Rs {amt} on {date}; {name} credited. UPI:{utr}. Call 18002662 for dispute. SMS BLOCK {a4} to 9215676766.'),
  G('bank-4', 'test', 'en', 'INR {amt} credited to A/c no. XX{a4} on {date} {time} by UPI Ref no {utr}. Avl Bal INR {amt2} -Axis Bank'),
  G('bank-5', 'dev', 'en', 'Sent Rs.{amt} from Kotak Bank AC X{a4} to {vpa} on {date}. UPI Ref {utr}. Not you, https://kotak.com/KBANKT/Fraud'),
  G('bank-6', 'test', 'hi', 'आपके खाता XX{a4} से दिनांक {date} को रु.{amt} डेबिट किए गए। यूपीआई संदर्भ {utr}। यदि आपने नहीं किया तो 1800111109 पर कॉल करें -एसबीआई'),
  G('upi-1', 'dev', 'en', 'You paid ₹{amt} to {name} using PhonePe. Transaction ID T{utr}. Check history in the app.'),
  G('upi-2', 'test', 'en', 'Payment of Rs {amt} to {vpa} successful. UPI transaction ID {utr}. - Google Pay'),
  G('otp-g1', 'dev', 'en', '{otp} is your OTP for transaction of Rs {amt} at AMAZON on HDFC Bank card XX{a4}. Valid for 10 mins. Do not share OTP with anyone. -HDFC Bank'),
  G('otp-g2', 'test', 'en', 'Dear Customer, OTP for login to SBI YONO is {otp}. Never share your OTP, PIN or password with anyone. SBI never asks for it.'),
  G('otp-g3', 'dev', 'en', '{otp} is your Amazon OTP. Do not share it with anyone.'),
  G('otp-g4', 'test', 'en', 'Your Aadhaar OTP is {otp}. Do not share it with anyone. -UIDAI'),
  G('otp-g5', 'test', 'mr', '{otp} हा तुमचा OTP आहे. तो कोणालाही सांगू नका.'),
  G('ship-1', 'dev', 'en', 'Your Amazon order #{order} has been shipped and will arrive by {date}. Track: https://amzn.in/d/{code}'),
  G('ship-2', 'test', 'en', 'Flipkart: Your package with {item} is out for delivery today. The delivery agent may call you. Track: https://fkrt.it/{code}'),
  G('ship-3', 'dev', 'en', 'Delhivery: We could not deliver your shipment {awb} today as the receiver was unavailable. We will try again tomorrow.'),
  G('ship-4', 'test', 'en', 'India Post: Article {awb} has been delivered on {date}. Track at https://www.indiapost.gov.in'),
  G('ship-5', 'dev', 'en', 'Your Swiggy order is on the way. Delivery partner {name} will reach in 15 minutes.'),
  G('bill-g1', 'dev', 'en', 'Dear consumer, your electricity bill of Rs {amt} for Oct is generated. Due date {date}. Pay at https://www.bsesdelhi.com or the BSES app.'),
  G('bill-g2', 'test', 'en', 'MSEDCL: Consumer No {cons} bill amount Rs {amt} due date {date}. Pay online at https://wss.mahadiscom.in to avoid late fee.'),
  G('bill-g3', 'dev', 'en', 'Your Airtel postpaid bill of Rs {amt} is due on {date}. Pay using the Airtel Thanks app: https://i.airtel.in/pay'),
  G('bill-g4', 'test', 'en', 'Jio: Your plan expires on {date}. Recharge now with MyJio app or at https://www.jio.com to continue enjoying services.'),
  G('bill-g5', 'test', 'en', 'Reminder: your bill payment is overdue. Please pay before {date} to avoid disconnection of services. - Tata Power'),
  G('bill-g6', 'dev', 'hi', 'बिजली बिल रु. {amt} जमा करने की अंतिम तिथि {date} है। समय पर भुगतान करें।'),
  G('bill-g7', 'test', 'mr', 'तुमचे वीज बिल रु. {amt} आहे. देय दिनांक {date}. महावितरण'),
  G('misc-1', 'dev', 'en', 'Your EMI of Rs {amt} for loan account ending {a4} will be debited on {date}. Keep sufficient balance. -Bajaj Finance'),
  G('misc-2', 'test', 'en', 'HDFC Bank: You are pre-approved for a personal loan of Rs 5,00,000. Apply on NetBanking or visit https://www.hdfcbank.com'),
  G('misc-3', 'dev', 'en', 'Hi beta, reached home safely. Call me when you are free.'),
  G('misc-4', 'test', 'hinglish', 'Mummy main late aaunga, khana kha lena.'),
  G('misc-5', 'dev', 'en', 'Your appointment with Dr {name} is confirmed for {date} at {time}. Reply C to cancel.'),
  G('misc-6', 'test', 'en', 'Dear Customer, your credit card statement for Oct is ready. Total due Rs {amt}, minimum due Rs {small_amt}, due by {date}. -ICICI Bank'),
  G('misc-7', 'test', 'en', 'IRCTC: PNR {pnr} confirmed, Train 12951, {date}, Coach B2 Seat 34. Have a safe journey.'),
];

export function generate() {
  const out = { dev: [], test: [] };
  for (const t of TEMPLATES) {
    const r = rng([...t.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
    const seen = new Set();
    for (let i = 0; i < FILLS_PER_TEMPLATE; i++) {
      const text = t.text.replace(/\{(\w+)\}/g, (_, k) => {
        if (!SLOTS[k]) throw new Error(`Unknown slot {${k}} in ${t.id}`);
        return SLOTS[k](r);
      });
      if (seen.has(text)) continue; // templates without slots produce one message, not four copies
      seen.add(text);
      out[t.split].push({ id: `${t.id}.${seen.size}`, template: t.id, label: t.label, type: t.type, lang: t.lang, text });
    }
  }
  return out;
}

export const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sets = generate();
  for (const [split, rows] of Object.entries(sets)) {
    await writeFile(new URL(`./${split}.jsonl`, import.meta.url), toJsonl(rows));
    console.log(`${split}: ${rows.length} messages`);
  }
}
