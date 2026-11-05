// Browser checks, run against a local server of dist/.
// Usage: node tests/e2e.mjs http://127.0.0.1:8080 [screenshot_dir]
// Needs Playwright with Chromium: npm install --no-save playwright && npx playwright install chromium
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
const SHOTS = process.argv[3];
const failures = [];

function check(cond, msg) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures.push(msg);
}

async function share(page, action, fields) {
  await page.evaluate(([act, entries]) => {
    const f = document.createElement('form');
    f.method = 'POST';
    f.action = act;
    f.enctype = 'multipart/form-data';
    for (const [k, v] of entries) {
      const i = document.createElement('input');
      i.type = 'hidden';
      i.name = k;
      i.value = v;
      f.append(i);
    }
    document.body.append(f);
    f.submit();
  }, [action, Object.entries(fields)]);
}

// Polls from Node: page-side waitForFunction strings need eval, which the app's CSP rightly blocks.
async function until(cond, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (await cond()) return true;
  throw new Error('timed out waiting for the page');
}

// Every cache name and IndexedDB database on the origin: only the app's own precache may exist.
const storageNames = (page) => page.evaluate(async () => ({
  caches: await caches.keys(),
  idb: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
  local: Object.keys(localStorage),
}));

const browser = await chromium.launch();

// 1. Without JavaScript the 1930 button, the Help steps and the static Check signs still work.
let ctx = await browser.newContext({ javaScriptEnabled: false });
let page = await ctx.newPage();
await page.goto(`${BASE}/help/`);
check((await page.locator('a[href="tel:1930"]').count()) >= 1, 'no-JS: tel:1930 link present on Help');
check((await page.locator('ol.journey > li').count()) === 7, 'no-JS: seven journey steps render');
check(await page.locator('.js-only').first().isHidden() && await page.locator('#nojs').isVisible(), 'no-JS: interactive parts stay hidden, the letter explains it needs JavaScript');
await page.goto(`${BASE}/check/`);
check(await page.locator('#ask').isHidden(), "no-JS: 'Ask my family' stays hidden on Check");
check(await page.locator('#run').isHidden(), 'no-JS: Check button stays hidden');
check(await page.locator('#fallback').isVisible(), 'no-JS: static scam signs are shown');
for (const [from, to] of [['/report/', '/help/#letter'], ['/hi/case/', '/hi/help/']]) {
  await page.goto(`${BASE}${from}`);
  await page.waitForURL(`${BASE}${to}`);
  check((await page.locator('a[href="tel:1930"]').count()) >= 1, `no-JS: ${from} forwards to ${to}, with 1930`);
}
await ctx.close();

// 2. With JavaScript: service worker installs, CSP raises no violations, pages work offline.
ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/`);
await page.evaluate('navigator.serviceWorker.ready');
await page.reload();
check(await page.evaluate('!!navigator.serviceWorker.controller'), 'service worker controls the page');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/home-en.png`, fullPage: true });

await ctx.setOffline(true);
for (const path of ['/', '/help/', '/check/', '/hi/', '/mr/help/', '/help/?utm_source=whatsapp', '/help']) {
  await page.goto(`${BASE}${path}`);
  check((await page.locator('a[href="tel:1930"]').count()) >= 1, `offline: ${path} opens with the 1930 button`);
}
// The rules are precached, so Check works offline too.
await page.goto(`${BASE}/check/`);
await page.locator('#run').waitFor();
await page.fill('#msg', 'Install AnyDesk and tell us the code');
await page.click('#run');
check((await page.locator('#result').getAttribute('data-verdict')) === 'likely', 'offline: Check gives a verdict');
for (const [from, to] of [['/report/', '/help/#letter'], ['/hi/case/', '/hi/help/']]) {
  await page.goto(`${BASE}${from}`);
  await page.waitForURL(`${BASE}${to}`);
  check(await page.locator('ol.journey').isVisible(), `offline: ${from} lands on the journey`);
}
await ctx.setOffline(false);

// 3. Share target: a POST is answered by the worker, and the shared message is checked at once.
await page.goto(`${BASE}/hi/`);
await share(page, '/hi/share-target/', { text: 'Your KYC expires today. Update now: http://bit.ly/x', title: 'SBI Alert' });
await page.waitForURL(`${BASE}/hi/check/**`);
await page.locator('#result').waitFor();
const value = await page.inputValue('#msg');
check(value.includes('KYC expires') && value.includes('SBI Alert'), 'share: text lands in the Hindi Check box');
check(page.url() === `${BASE}/hi/check/`, 'share: ?shared=1 removed from the address bar');
let names = await storageNames(page);
check(names.caches.length === 1 && /^gh-[0-9a-f]{12}$/.test(names.caches[0]) && !names.idb.length && !names.local.length, 'share: nothing written to Cache Storage, IndexedDB or localStorage');
await page.goto(`${BASE}/hi/check/?shared=1`);
await page.locator('#run').waitFor();
check((await page.inputValue('#msg')) === '', 'share: handed over once; a later page never sees it');
await page.goto(`${BASE}/hi/check/`);
await share(page, '/hi/share-target/', { text: 'Your KYC expires today. Update now: http://bit.ly/x', title: 'SBI Alert' });
await page.waitForURL(`${BASE}/hi/check/**`);
await page.locator('#result').waitFor();
check((await page.locator('#result').getAttribute('data-verdict')) === 'likely', 'share: verdict shown without a tap');
check((await page.textContent('#verdict')).trim() === 'शायद धोखा है', 'share: verdict in Hindi');
check(await page.locator('#fallback').isHidden(), 'share: static fallback hidden once a verdict shows');
check(await page.evaluate("document.activeElement?.id === 'result'"), 'share: focus moves to the verdict for screen readers');
check(await page.locator('#ask').isVisible(), "JS: 'Ask my family' button shown");
if (SHOTS) await page.screenshot({ path: `${SHOTS}/check-hi-shared.png`, fullPage: true });

// 4. Pasting and checking in English: verdict, type, rule and signs; a genuine OTP is not called a scam.
await page.goto(`${BASE}/check/`);
await page.locator('#run').waitFor();
await page.click('#run');
check((await page.innerText('#status')).trim() !== '', 'Check on an empty box explains what to do');
await page.fill('#msg', 'Dear Customer, your SBI YONO account will be blocked today. Update PAN now: https://sbi-kyc-update.com/a');
await page.click('#run');
check((await page.textContent('#verdict')) === 'Likely scam', 'paste: likely scam');
check((await page.textContent('#type')) === 'KYC update or account block', 'paste: scam type named');
check((await page.textContent('#rule')).startsWith('Banks never ask'), 'paste: the one rule is shown');
check((await page.locator('#found li').count()) >= 2, 'paste: signs listed');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/check-en-likely.png`, fullPage: true });
await page.fill('#msg', '482913 is your OTP for login. Do not share OTP with anyone. -HDFC Bank');
check(await page.locator('#result').isHidden(), 'editing the message hides the old verdict');
await page.click('#run');
check((await page.textContent('#verdict')) === 'No common scam signs found', 'genuine OTP: no common signs found');
check((await page.textContent('#type')) === '', 'genuine OTP: no scam type shown');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/check-en-none.png`, fullPage: true });

// 5. Ask my family carries the verdict; "I already paid" goes to Help.
await page.fill('#msg', 'Install AnyDesk and tell us the code');
await page.evaluate("navigator.share = undefined; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }");
await page.click('#ask');
const copied = await page.evaluate('window.__copied');
check(/Golden Hour check: Likely scam \(OTP or screen-sharing request\)/.test(copied) && copied.includes('AnyDesk'), 'Ask my family includes the verdict and the message');
await page.click('a.secondary');
await page.waitForURL(`${BASE}/help/`);
check(true, "'I already paid' opens Help");

await page.goto(`${BASE}/mr/check/`);
await page.locator('#run').waitFor();
await page.fill('#msg', 'प्रिय ग्राहक, आपले वीज कनेक्शन आज रात्री 9.30 वाजता खंडित केले जाईल. त्वरित संपर्क करा 9876543210');
await page.click('#run');
check((await page.textContent('#type')) === 'वीज किंवा बिल खंडित होण्याची भीती', 'Marathi: bill scam named in Marathi');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/check-mr.png`, fullPage: true });

const ctx2 = await browser.newContext({ colorScheme: 'dark', viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/check/`);
await p2.locator('#run').waitFor();
await p2.fill('#msg', 'Congratulations! You won Rs 25,00,000 in the KBC lucky draw. Pay tax first to 9876543210');
await p2.click('#run');
if (SHOTS) await p2.screenshot({ path: `${SHOTS}/check-en-dark.png`, fullPage: true });
await ctx2.close();

// 6. Home: Install app (D5) and the "I lost money" door naming the next step.
const fireInstall = () => window.addEventListener('load', () => {
  const e = new Event('beforeinstallprompt');
  e.prompt = () => { window.__prompted = true; };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
});
const standaloneMode = () => {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q) => (q.includes('display-mode: standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
};
let ictx = await browser.newContext();
await ictx.addInitScript(fireInstall);
let ip = await ictx.newPage();
await ip.goto(`${BASE}/`);
await ip.locator('#install').waitFor();
check(await ip.locator('#install-btn').isVisible(), 'install: button appears when beforeinstallprompt fires');
await ip.click('#install-btn');
check(await ip.evaluate('window.__prompted === true'), 'install: the button opens the browser install prompt');
await until(async () => ip.locator('#install').isHidden());
check(true, 'install: hidden once installed');
await ictx.close();

ictx = await browser.newContext();
await ictx.addInitScript(standaloneMode);
await ictx.addInitScript(fireInstall);
ip = await ictx.newPage();
await ip.goto(`${BASE}/`);
await ip.waitForTimeout(1800);
check(await ip.locator('#install').isHidden(), 'install: hidden when already running as the installed app');
await ictx.close();

ictx = await browser.newContext();
ip = await ictx.newPage();
await ip.goto(`${BASE}/mr/`);
check(await ip.locator('#install').isHidden(), 'install: not shown before the browser has had a chance to offer a prompt');
await ip.locator('#install-btn').waitFor({ state: 'visible', timeout: 4000 });
await ip.click('#install-btn');
check((await ip.innerText('#install-help')).includes('Add to Home Screen'), 'install: without a prompt event, instructions show (iOS and other browsers)');
check(await ip.locator('html[lang="mr"] #install-help').isVisible(), 'install: instructions are on the Marathi page');
await ictx.close();

// 7. The journey: case on this phone, call card, proof, letter. Speech and voices are faked.
const SMS = 'Dear Customer, your A/c XX4821 is debited by Rs.12,000.00 on 28-Oct-26 trf to Ramesh Kumar Refno 482910384756. -SBI\n\n'
  + 'Rs.1,499.50 debited from a/c **4821 on 28-Oct-26 to VPA refund221@ybl (UPI Ref No 773829104857). -HDFC Bank';
const fakes = ({ onDevice, localVoice }) => {
  class FakeRecognition {
    static async available() { await new Promise((r) => setTimeout(r, window.__slow || 0)); return 'available'; }
    start() { window.__instances = (window.__instances || 0) + 1; window.__started = { local: !!this.processLocally }; setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'He called from 9876543210 and said my KYC expired.' }], { isFinal: true })] }), 50); }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  if (!onDevice) delete FakeRecognition.available;
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true });
  const voices = [{ name: 'Remote', lang: 'en-IN', localService: false }, { name: 'Remote hi', lang: 'hi-IN', localService: false }];
  if (localVoice) voices.push({ name: 'Local', lang: 'en-IN', localService: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => voices, speak: (u) => { window.__spoken = u.text; window.__voice = u.voice?.name; }, cancel() {}, addEventListener() {},
  } });
};
const allowed = new Set(['lossAt', 'amount', 'ack', 'bankRef', 'mrmId', 'bank', 'utrs', 'done']);
// Taps Correct on every card of the given kinds (all kinds by default).
async function confirmCards(p, kinds = ['amount', 'when', 'utr', 'payee', 'bank', 'scammer']) {
  for (const kind of kinds) {
    const n = await p.locator(`.card[data-kind="${kind}"]`).count();
    for (let i = 0; i < n; i++) await p.locator(`.card[data-kind="${kind}"]`).nth(i).getByRole('button', { name: /^(Correct|सही|बरोबर)$/ }).click();
  }
}
async function pasteProof(p, text) {
  await p.locator('#paste summary').click();
  await p.fill('#sms', text);
  await p.click('#find');
  await p.locator('#review:not([hidden])').waitFor();
}
const savedCase = async (p) => JSON.parse((await p.evaluate("localStorage.getItem('gh-case-v1')")) || '{}');

const rctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
await rctx.addInitScript(fakes, { onDevice: true, localVoice: true });
const rp = await rctx.newPage();
rp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
rp.on('pageerror', (e) => errors.push(String(e)));
await rp.goto(`${BASE}/`);
await rp.click('a.door-primary');
await rp.waitForURL(`${BASE}/help/`);
await rp.locator('#ack').waitFor();
check(await rp.locator('#nojs').isHidden() && (await rp.locator('[data-done]:visible').count()) === 7, 'journey: loads with a done button on each step');
check(await rp.locator('#step-call.is-next').count() === 1, 'journey: step 1 is marked as the next step');
check(await rp.locator('#read-aloud').isHidden() && await rp.locator('#ready-empty').isVisible(), 'call card: empty until there are details');

await rp.fill('#ack', '1234');
await rp.click('#ack-save');
check((await rp.innerText('#ack-status')).includes('14 digits'), 'ack: a wrong number is rejected with a helpful message');
await rp.fill('#ack', '31910280012345');
await rp.click('#ack-save');
check((await savedCase(rp)).ack === '31910280012345' && !!(await savedCase(rp)).done?.call, 'ack: a valid number is saved and step 1 is marked done');

await pasteProof(rp, SMS);
check((await rp.locator('.card[data-kind="amount"]').count()) === 2, 'proof: two amounts found in the pasted SMS');
check(!(await rp.evaluate("localStorage.getItem('gh-case-v1')")).includes('13499'), 'proof: nothing enters the case before Correct');
await confirmCards(rp, ['amount']);
check((await savedCase(rp)).amount === '13499.50' && (await rp.innerText('#total-line')).includes('Rs 13,499.50'), 'proof: total computed from the amounts marked Correct');
await rp.locator('.card[data-kind="amount"]').nth(1).getByRole('button', { name: 'Wrong' }).click();
check((await savedCase(rp)).amount === '12000.00', 'proof: marking a value Wrong takes it out of the case');
await rp.locator('.card[data-kind="amount"]').nth(1).getByRole('button', { name: 'Correct' }).click();
await confirmCards(rp, ['when', 'utr', 'payee', 'bank']);
let c = await savedCase(rp);
check(c.amount === '13499.50' && c.utrs?.length === 2 && c.lossAt === '2026-10-28' && ['State Bank of India', 'HDFC Bank'].includes(c.bank), 'proof: amount, UTRs, date and bank saved to the case');
check((await rp.locator('.card[data-kind="utr"] .card-source').first().innerText()).includes('Refno 482910384756'), 'proof: each card shows the line it came from');

// Portal copilot: one stage at a time, the case's values to copy, evidence under 5 MB, the ack number.
await rp.evaluate("navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }");
check((await rp.innerText('#stage-count')) === 'Stage 1 of 7' && (await rp.locator('#stages > .stage:visible').count()) === 1, 'portal: one stage at a time');
await rp.click('#stage-next');
await rp.click('#stage-next');
const incident = rp.locator('#stages > .stage[data-stage="2"]');
await incident.getByRole('button', { name: /Copy: Amount lost/ }).click();
check((await rp.evaluate('window.__copied')) === '13499.50', 'portal: Copy gives the amount from the case');
await incident.getByRole('button', { name: /Copy: Transaction IDs \(UTR\) 773829104857/ }).click();
check((await rp.evaluate('window.__copied')) === '773829104857' && (await rp.innerText('#walk-status')).includes('773829104857'), 'portal: each UTR has its own Copy button, and copying is announced');
await rp.click('#stage-next');
await rp.locator('#stages > .stage[data-stage="3"]').getByRole('button', { name: /refund221@ybl/ }).click();
check((await rp.evaluate('window.__copied')) === 'refund221@ybl', "portal: the scammer's UPI ID from a confirmed card can be copied");
await rp.click('#stage-next');
await rp.click('#stage-next');
const big = Buffer.from(await rp.evaluate(() => {
  const c = Object.assign(document.createElement('canvas'), { width: 2600, height: 2600 });
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(2600, 2600);
  for (let i = 0; i < img.data.length; i++) img.data[i] = (i % 4 === 3) ? 255 : Math.floor(Math.random() * 256);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}), 'base64');
check(big.length > 5 * 1024 * 1024, `evidence: test image is over 5 MB (${(big.length / 1048576).toFixed(1)} MB)`);
await rp.setInputFiles('#evidence', { name: 'photo.png', mimeType: 'image/png', buffer: big });
await rp.locator('#evidence-list a').waitFor({ timeout: 60000 });
const [download] = await Promise.all([rp.waitForEvent('download'), rp.click('#evidence-list a')]);
const dlPath = await download.path();
const dlSize = (await import('node:fs')).statSync(dlPath).size;
check(dlSize > 0 && dlSize < 5 * 1024 * 1024 && download.suggestedFilename() === 'golden-hour-evidence-01.jpg', `evidence: an image over 5 MB comes out as a JPEG under 5 MB (${(dlSize / 1048576).toFixed(2)} MB)`);
await rp.click('#stage-next');
check((await rp.innerText('#stage-count')) === 'Stage 7 of 7' && await rp.locator('#stage-next').isDisabled(), 'portal: last stage reached; Next is disabled');
// Tell the bank: chosen from the list, a prefilled email, the complaint number saved.
check(['State Bank of India', 'HDFC Bank'].includes(await rp.inputValue('#bank-pick')), 'bank: the confirmed bank is preselected');
check((await rp.innerText('#bank-contact')).includes('Report fraud option in your bank'), 'bank: not yet verified, so the person is sent to the bank app or card, never a search');
const mailto = await rp.getAttribute('#bank-write', 'href');
const mailBody = decodeURIComponent(mailto.split('body=')[1]);
check(mailto.startsWith('mailto:?subject=') && mailBody.includes('Rs 13,499.50') && mailBody.includes('482910384756, 773829104857') && mailBody.includes('31910280012345') && mailBody.length <= 1800,
  'bank: Write to my bank opens an email with the amount, UTRs and acknowledgement number, under 1,800 characters');
await rp.click('#bank-copy');
check((await rp.evaluate('window.__copied')).startsWith('Fraud report: unauthorised transactions of Rs 13,499.50'), 'bank: Copy the text gives subject and body');
await rp.fill('#bank-ref', 'x');
await rp.click('#bank-ref-save');
check((await rp.innerText('#bank-ref-status')).includes('exactly as the bank gave it'), 'bank: a malformed complaint number is refused');
await rp.fill('#bank-ref', 'HDFC/2026/88123');
await rp.click('#bank-ref-save');
c = await savedCase(rp);
check(c.bankRef === 'HDFC/2026/88123' && !!c.done?.bank, 'bank: complaint number saved and the step marked done');
await rp.selectOption('#bank-pick', '');
check(!(await savedCase(rp)).bank, 'bank: choosing Other removes the bank from the case');
await rp.selectOption('#bank-pick', 'HDFC Bank');

await rp.fill('#portal-ack', '2191028001');
await rp.click('#portal-ack-save');
check((await rp.innerText('#portal-ack-status')).includes('14 digits'), 'portal ack: an invalid number is rejected with a helpful message');
await rp.fill('#portal-ack', '3191 0280 0123 45');
await rp.click('#portal-ack-save');
check((await rp.innerText('#portal-ack-status')).includes('Starts with 3: a complaint registered by calling 1930') && (await savedCase(rp)).ack === '31910280012345', 'portal ack: saved, and the prefix is explained');
check(!!c.done?.proof && (await rp.locator('#step-block.is-next').count()) === 1, 'proof: step marked done and the next step moves on');
const ready = await rp.innerText('#ready-list');
check(ready.includes('Rs 13,499.50') && ready.includes('482910384756') && ready.includes('refund221@ybl'), 'call card: amount, UTRs and the scammer UPI ID shown');
check(await rp.locator('#read-aloud').isVisible(), 'read aloud: offered when the phone has an on-device voice');
await rp.click('#read-aloud');
check((await rp.evaluate('window.__voice')) === 'Local' && (await rp.evaluate('window.__spoken')).includes('4 8 2 9'), 'read aloud: uses the on-device voice and reads UTRs digit by digit');

await rp.click('[data-done="block"]');
check((await rp.getAttribute('[data-done="block"]', 'aria-pressed')) === 'true' && (await rp.innerText('[data-done="block"]')).includes('2026'), 'done: marking a step done shows the date in Latin digits');
await rp.click('[data-done="block"]');
check((await rp.getAttribute('[data-done="block"]', 'aria-pressed')) === 'false', 'done: tapping again undoes it');

await rp.click('.report-form > button.primary');
check((await rp.innerText('#form-status')).trim() !== '', 'letter: an empty story explains what to do');
await rp.evaluate('window.__slow = 300');
await rp.click('#mic');
await rp.click('#mic');
await until(async () => (await rp.inputValue('#story')).includes('9876543210'));
check(await rp.evaluate('window.__started.local') && !(await rp.locator('dialog').count()), 'mic: on-device speech is used without asking');
check((await rp.evaluate('window.__instances')) === 1, 'mic: a double tap starts only one recorder');
await rp.click('#mic');
await rp.fill('#name', 'Sunita Deshpande');
await rp.fill('#mobile', '9123456780');
await rp.selectOption('#channel', 'call');
await rp.click('.report-form > button.primary');
await rp.locator('#doc').waitFor();
let doc = await rp.innerText('#doc');
check(doc.includes('Rs 13,499.50') && doc.includes('482910384756') && doc.includes('Sunita Deshpande') && doc.includes('Phone call'), 'letter: total, UTR, name and contact method');
check(doc.includes('31910280012345') && doc.includes('KYC update or account block'), 'letter: acknowledgement number from the case, fraud type from the story');
check((await rp.inputValue('#contacts')).includes('9876543210') && (await rp.inputValue('#contacts')).includes('refund221@ybl'), "letter: scammer's number and UPI ID listed");
await rp.locator('.card[data-kind="amount"]').first().getByRole('button', { name: 'Edit' }).click();
await rp.fill('#edit-c0', '10,000.00');
await rp.locator('#card-c0').getByRole('button', { name: 'Save', exact: true }).click();
check((await savedCase(rp)).amount === '1499.50', 'proof: an edited value leaves the case until it is marked Correct again');
await rp.locator('.card[data-kind="amount"]').first().getByRole('button', { name: 'Correct' }).click();
await rp.click('.report-form > button.primary');
check((await rp.innerText('#doc')).includes('Rs 11,499.50'), 'letter: an edited, confirmed amount updates the total');
await rp.selectOption('#fraud-type', 'otp');
check((await rp.innerText('#doc')).includes('OTP or screen-sharing request'), 'letter: fraud type can be changed');
c = await savedCase(rp);
const raw = await rp.evaluate("localStorage.getItem('gh-case-v1')");
check(Object.keys(c).every((k) => allowed.has(k)) && !/Sunita|9123456780|9876543210|refund221|KYC expired|4821/.test(raw), 'privacy: the saved case holds no name, phone, UPI ID, account digits or story');
names = await storageNames(rp);
check(names.local.join() === 'gh-case-v1' && !names.idb.length, 'privacy: the case is the only thing in localStorage, no IndexedDB');

await rp.emulateMedia({ media: 'print' });
const pdf = (await rp.pdf()).toString('latin1');
await rp.emulateMedia({ media: 'screen' });
const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
check(pages >= 1 && pages <= 3, `print: only the letter prints (${pages} pages)`);
await rp.evaluate("navigator.share = undefined; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }");
await rp.click('#copy');
const copiedReport = await rp.evaluate('window.__copied');
check(copiedReport.startsWith('To,') && copiedReport.includes('Total amount lost: Rs 11,499.50'), 'letter: Copy gives the full letter as text');
if (SHOTS) await rp.screenshot({ path: `${SHOTS}/journey-filled.png`, fullPage: true });

// The case survives a reload: the call card and a letter still work from the saved fields alone.
await rp.reload();
await rp.locator('#ack').waitFor();
check((await rp.inputValue('#ack')) === '31910280012345' && (await rp.innerText('#ready-list')).includes('Rs 11,499.50'), 'case: kept after reload');
check(!(await rp.innerText('#ready-list')).includes('refund221'), "case: the scammer's UPI ID was never stored");
await rp.fill('#story', 'They called me.');
await rp.click('.report-form > button.primary');
doc = await rp.innerText('#doc');
check(doc.includes('Rs 11,499.50') && doc.includes('773829104857'), 'letter: built from the saved case after a reload');
await rp.goto(`${BASE}/`);
check((await rp.innerText('#help-sub')).includes('Block your card and UPI'), 'home: the I lost money door names the next step');
await rp.goto(`${BASE}/help/`);
await rp.locator('#clear').click();
check(!(await rp.evaluate("localStorage.getItem('gh-case-v1')")) && await rp.locator('#ready-empty').isVisible() && (await rp.inputValue('#ack')) === '', 'Clear everything removes the case from the phone');
await rctx.close();

// Hindi, without on-device speech or voices: the mic asks first; no read-aloud through a network voice.
const cctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await cctx.addInitScript(fakes, { onDevice: false, localVoice: false });
const cp = await cctx.newPage();
await cp.goto(`${BASE}/hi/help/`);
await cp.locator('#mic').waitFor();
await pasteProof(cp, SMS);
await confirmCards(cp);
check(await cp.locator('#read-aloud').isHidden(), 'read aloud: never offered with only network voices');
await cp.click('#mic');
check(await cp.locator('dialog.consent').isVisible(), 'mic: asks before sending a voice off the phone');
check((await cp.getAttribute('dialog.consent', 'aria-labelledby')) === 'consent-title', 'mic: the dialog has an accessible name');
check((await cp.textContent('dialog.consent h2')) === 'आपकी आवाज़ इस फ़ोन से बाहर जाएगी', 'mic: the warning is in the page language');
await cp.locator('dialog.consent .secondary').click();
check(!(await cp.evaluate('window.__started')) && (await cp.inputValue('#story')) === '', 'mic: "Type instead" never starts recording');
await cp.click('#mic');
await cp.locator('dialog.consent .primary').click();
await until(async () => (await cp.inputValue('#story')).length > 0);
check(await cp.evaluate('window.__started.local === false'), 'mic: after consent, cloud speech is used');
await cp.click('.report-form > button.primary');
await cp.locator('#doc').waitFor();
check((await cp.innerText('#doc')).includes('विषय: Rs 13,499.50 की ऑनलाइन वित्तीय धोखाधड़ी की शिकायत'), 'letter: Hindi letter');
const hiBody = decodeURIComponent((await cp.getAttribute('#bank-write', 'href')).split('body=')[1]);
check(hiBody.includes('कृपया मेरा डेबिट कार्ड, UPI और नेट बैंकिंग तुरंत बंद करें') && hiBody.includes('Rs 13,499.50'), 'bank: the Hindi email decodes correctly');
for (let i = 0; i < 6; i++) await cp.click('#stage-next');
await cp.fill('#portal-ack', '21910280012345');
await cp.click('#portal-ack-save');
check((await cp.innerText('#portal-ack-status')).includes('2 से शुरू: पोर्टल पर दर्ज शिकायत'), 'portal ack: prefix 2 explained in Hindi');
await cctx.close();

// 8. Proof from files: two screenshots picked, two screenshots shared, a WhatsApp .zip export.
// The screenshots are rendered here, then read on the "phone" by the vendored OCR.
const shotsPage = await browser.newPage();
async function smsImage(text) {
  await shotsPage.setContent(`<div id="m" style="width:360px;padding:16px;font:17px FreeSans,sans-serif;background:#fff;color:#111"><div style="background:#ececec;border-radius:12px;padding:12px">${text}</div></div>`);
  return shotsPage.locator('#m').screenshot();
}
const img1 = await smsImage('Dear Customer, your A/c XX4821 is debited by Rs.12,000.00 on 28-Oct-26 trf to Ramesh Kumar Refno 482910384756. If not done by you, call 1800111109 -SBI');
const img2 = await smsImage('Rs.1,499.50 debited from a/c **4821 on 28-Oct-26 to VPA refund221@ybl (UPI Ref No 773829104857). Not you? Call 18002586161 -HDFC Bank');
await shotsPage.close();
// A stored (uncompressed) zip with one chat .txt and one "photo", like a WhatsApp export.
function storedZip(entries) {
  const enc = new TextEncoder();
  const parts = []; const central = []; let offset = 0;
  for (const [name, text] of entries) {
    const nb = enc.encode(name); const body = enc.encode(text);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(18, body.length, true); lh.setUint32(22, body.length, true); lh.setUint16(26, nb.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint32(20, body.length, true); ch.setUint32(24, body.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, offset, true);
    parts.push(new Uint8Array(lh.buffer), nb, body); central.push(new Uint8Array(ch.buffer), nb);
    offset += 30 + nb.length + body.length;
  }
  const cdLen = central.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdLen, true); end.setUint32(16, offset, true);
  return Buffer.concat([...parts, ...central, new Uint8Array(end.buffer)].map((a) => Buffer.from(a)));
}
const chatZip = storedZip([
  ['WhatsApp Chat with Agent.txt', '28/10/26, 2:15 pm - +91 98765 43210: Sir pay processing fee to help123@ybl\n28/10/26, 2:16 pm - You: ok'],
  ['IMG-20261028-WA0001.jpg', 'not a real photo'],
]);

const fctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
const fp = await fctx.newPage();
fp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
fp.on('pageerror', (e) => errors.push(String(e)));
await fp.goto(`${BASE}/`);
await fp.evaluate('navigator.serviceWorker.ready');
await fp.goto(`${BASE}/help/`);
await fp.locator('#files').waitFor({ state: 'attached' });
check(await fp.locator('label[for="files"]').isVisible(), 'proof: Choose screenshots button shown');
await fp.setInputFiles('#files', [
  { name: 'sms1.png', mimeType: 'image/png', buffer: img1 },
  { name: 'sms2.png', mimeType: 'image/png', buffer: img2 },
]);
await fp.locator('#review:not([hidden])').waitFor({ timeout: 120000 });
const pickedUtrs = await fp.locator('.card[data-kind="utr"] .card-value').allInnerTexts();
check(pickedUtrs.includes('482910384756') && pickedUtrs.includes('773829104857'), `picked screenshots: both UTRs read on the phone (${pickedUtrs})`);
await confirmCards(fp, ['amount']);
check((await savedCase(fp)).amount === '13499.50', 'picked screenshots: total from the two confirmed amounts');
await fp.setInputFiles('#files', { name: 'WhatsApp Chat with Agent.zip', mimeType: 'application/zip', buffer: chatZip });
await fp.locator('.card[data-kind="scammer"]').first().waitFor({ timeout: 20000 });
const scammer = await fp.locator('.card[data-kind="scammer"] .card-value').allInnerTexts();
check(scammer.some((x) => x.includes('98765 43210')) && scammer.some((x) => x.includes('help123@ybl')), `chat export (.zip): scammer number and UPI ID found (${scammer})`);

// Share two screenshots to the app: they arrive on the proof step, in memory.
await fp.goto(`${BASE}/hi/`);
await fp.evaluate(async ([a, b]) => {
  const f = document.createElement('form');
  f.method = 'POST'; f.action = '/hi/share-target/'; f.enctype = 'multipart/form-data';
  const input = document.createElement('input');
  input.type = 'file'; input.name = 'files'; input.multiple = true;
  const dt = new DataTransfer();
  for (const [name, b64] of [['s1.png', a], ['s2.png', b]]) dt.items.add(new File([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], name, { type: 'image/png' }));
  input.files = dt.files;
  f.append(input);
  document.body.append(f);
  f.submit();
}, [img1.toString('base64'), img2.toString('base64')]);
await fp.waitForURL(`${BASE}/hi/help/**`);
await fp.locator('#review:not([hidden])').waitFor({ timeout: 120000 });
const sharedUtrs = await fp.locator('.card[data-kind="utr"] .card-value').allInnerTexts();
check(sharedUtrs.includes('482910384756') && sharedUtrs.includes('773829104857'), 'shared screenshots: land on the Hindi proof step and are read');
names = await storageNames(fp);
const ocrKeys = await fp.evaluate(async () => (await (await caches.open('gh-ocr-7.0.0')).keys()).map((r) => new URL(r.url).pathname));
check(names.caches.every((k) => /^gh-[0-9a-f]{12}$/.test(k) || k === 'gh-ocr-7.0.0') && !names.idb.length && names.local.join() === 'gh-case-v1',
  `images: no IndexedDB, no extra caches, only the case in localStorage (${names.caches}; ${names.idb}; ${names.local})`);
check(ocrKeys.length > 0 && ocrKeys.every((k) => k.startsWith('/vendor/') || k === '/ocr.js'), 'images: the OCR cache holds only the engine and language data, never an image');
check(!(await fp.evaluate("localStorage.getItem('gh-case-v1')")).includes('png'), 'images: nothing about the screenshots in the saved case');
await fctx.close();

const mctx = await browser.newContext();
const mp = await mctx.newPage();
await mp.goto(`${BASE}/mr/help/`);
await mp.locator('#ack').waitFor();
await mp.evaluate("localStorage.setItem('gh-case-v1', JSON.stringify({ done: { call: '2026-10-28' } }))");
await mp.reload();
await mp.locator('[data-done="call"][aria-pressed="true"]').waitFor();
check(!/[०-९]/.test(await mp.innerText('[data-done="call"]')), 'Marathi: dates use Latin digits');
await mctx.close();

// The vendored OCR engine prints its own tuning notices ("Warning: Parameter not found: ...") to stderr;
// they are not page errors. Everything else still fails the run.
errors.splice(0, errors.length, ...errors.filter((e) => !/^Warning: Parameter not found: /.test(e)));
const csp = errors.filter((e) => e.includes('Content Security Policy') || e.includes('Refused'));
check(!csp.length, `no CSP violations (${csp.slice(0, 2)})`);
check(!errors.length, `no console errors (${errors.slice(0, 3)})`);
await browser.close();

console.log(`\n${failures.length} failure(s)`);
process.exit(failures.length ? 1 : 0);
