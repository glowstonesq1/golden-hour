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

const cacheHas = (page) => page.evaluate("caches.open('gh-share').then(c => c.match('/__shared__')).then(r => !!r)");

const browser = await chromium.launch();

// 1. Without JavaScript the 1930 button, the Help steps and the static Check signs still work.
let ctx = await browser.newContext({ javaScriptEnabled: false });
let page = await ctx.newPage();
await page.goto(`${BASE}/help/`);
check((await page.locator('a[href="tel:1930"]').count()) >= 1, 'no-JS: tel:1930 link present on Help');
check((await page.locator('ol.steps li').count()) === 5, 'no-JS: five Help steps render');
await page.goto(`${BASE}/check/`);
check(await page.locator('#ask').isHidden(), "no-JS: 'Ask my family' stays hidden on Check");
check(await page.locator('#run').isHidden(), 'no-JS: Check button stays hidden');
check(await page.locator('#fallback').isVisible(), 'no-JS: static scam signs are shown');
await page.goto(`${BASE}/report/`);
check(await page.locator('#nojs').isVisible() && await page.locator('#report-form').isHidden(), 'no-JS: report page explains it needs JavaScript');
check((await page.locator('a[href="tel:1930"]').count()) >= 1, 'no-JS: report page still has the 1930 button');
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
await ctx.setOffline(false);

// A leftover share is deleted by the next page load, whichever page it is.
await page.goto(`${BASE}/`);
await page.evaluate("caches.open('gh-share').then(c => c.put('/__shared__', new Response('left over')))");
await page.goto(`${BASE}/help/`);
await page.waitForFunction("caches.open('gh-share').then(c => c.match('/__shared__')).then(r => !r)");
check(true, 'leftover share deleted on the next page load');

// 3. Share target: a POST is answered by the worker, and the shared message is checked at once.
await page.goto(`${BASE}/hi/`);
await share(page, '/hi/share-target/', { text: 'Your KYC expires today. Update now: http://bit.ly/x', title: 'SBI Alert' });
await page.waitForURL(`${BASE}/hi/check/**`);
await page.locator('#result').waitFor();
const value = await page.inputValue('#msg');
check(value.includes('KYC expires') && value.includes('SBI Alert'), 'share: text lands in the Hindi Check box');
check(page.url() === `${BASE}/hi/check/`, 'share: ?shared=1 removed from the address bar');
check(!(await cacheHas(page)), 'share: shared text deleted from the cache after reading');
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

// 6. Report maker. Speech and on-device AI are faked so both paths of each run in a headless browser.
const SMS = 'Dear Customer, your A/c XX4821 is debited by Rs.12,000.00 on 28-Oct-26 trf to Ramesh Kumar Refno 482910384756. -SBI\n\n'
  + 'Rs.1,499.50 debited from a/c **4821 on 28-Oct-26 to VPA refund221@ybl (UPI Ref No 773829104857). -HDFC Bank';
const fakes = ({ onDevice }) => {
  class FakeRecognition {
    static async available() { await new Promise((r) => setTimeout(r, window.__slow || 0)); return 'available'; }
    start() { window.__instances = (window.__instances || 0) + 1; window.__started = { local: !!this.processLocally }; setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'He called from 9876543210 and said my KYC expired.' }], { isFinal: true })] }), 50); }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  if (!onDevice) delete FakeRecognition.available;
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true });
  Object.defineProperty(window, 'Summarizer', { configurable: true, value: {
    availability: async () => 'available',
    create: async () => ({ summarize: async () => window.__summary, destroy() {} }),
  } });
};
const rctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await rctx.addInitScript(fakes, { onDevice: true });
const rp = await rctx.newPage();
rp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
rp.on('pageerror', (e) => errors.push(String(e)));
await rp.goto(`${BASE}/help/`);
await rp.click('a.report-card');
await rp.waitForURL(`${BASE}/report/`);
check(await rp.locator('#report-form').isVisible() && await rp.locator('#nojs').isHidden(), 'Help links to the report maker, which loads');
await rp.click('.report-form > button.primary');
check((await rp.innerText('#form-status')).trim() !== '', 'report: an empty story explains what to do');
await rp.evaluate('window.__slow = 300');
await rp.click('#mic');
await rp.click('#mic');
await until(async () => (await rp.inputValue('#story')).includes('9876543210'));
check(await rp.evaluate('window.__started.local') && !(await rp.locator('dialog').count()), 'mic: on-device speech is used without asking');
check((await rp.evaluate('window.__instances')) === 1, 'mic: a double tap starts only one recorder');
await rp.click('#mic');
await rp.fill('#sms', SMS);
await rp.fill('#name', 'Sunita Deshpande');
await rp.fill('#mobile', '9123456780');
await rp.selectOption('#channel', 'call');
await rp.click('.report-form > button.primary');
await rp.locator('#review').waitFor();
check((await rp.locator('#payments .payment').count()) === 2, 'report: two payments found in the pasted SMS');
check((await rp.inputValue('#contacts')).includes('9876543210'), "report: the scammer's number is listed");
let doc = await rp.innerText('#doc');
check(doc.includes('Rs 13,499.50') && doc.includes('482910384756') && doc.includes('Sunita Deshpande') && doc.includes('Phone call'), 'report: letter has total, UTR, name and contact method');
check(doc.includes('KYC update or account block'), 'report: fraud type named from the story');
await rp.fill('#pay-0-amount', '10,000.00');
check((await rp.innerText('#doc')).includes('Rs 11,499.50'), 'report: editing an amount updates the total');
await rp.click('.report-form > button.primary');
check((await rp.inputValue('#pay-0-amount')) === '10,000.00', 'report: making the report again keeps corrections');
check((await rp.inputValue('#fraud-type')) === 'kyc', 'report: fraud type is pre-filled from the story');
await rp.selectOption('#fraud-type', 'otp');
check((await rp.innerText('#doc')).includes('OTP or screen-sharing request'), 'report: fraud type can be changed');
await rp.fill('#ack', '31910280012345');
check((await rp.innerText('#doc')).includes('31910280012345'), 'report: adding the 1930 number updates the letter');
if (SHOTS) await rp.screenshot({ path: `${SHOTS}/report-review.png` });

await rp.emulateMedia({ media: 'print' });
const pdf = (await rp.pdf()).toString('latin1');
await rp.emulateMedia({ media: 'screen' });
const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
check(pages >= 1 && pages <= 3, `print: only the letter prints (${pages} pages)`);
check(await rp.locator('#ai').isVisible(), 'AI: summary button shown where on-device AI exists');
await rp.evaluate("window.__summary = 'They took Rs 99,999 after calling from 9876543210.'");
await rp.click('#ai-run');
await until(async () => (await rp.textContent('#ai-status')).length > 0 && await rp.isEnabled('#ai-run'));
check(await rp.locator('#ai-result').isHidden() && !(await rp.innerText('#doc')).includes('99,999'), 'AI: a summary with an invented amount is thrown away');
await rp.evaluate("window.__summary = 'A caller from 9876543210 said the KYC expired; Rs 12,000.00 and Rs 1,499.50 were taken.'");
await rp.click('#ai-run');
await rp.locator('#ai-result').waitFor();
check(!(await rp.innerText('#doc')).includes('on-device AI draft'), 'AI: summary stays out until the person confirms it');
await rp.check('#ai-ok');
check((await rp.innerText('#doc')).includes('on-device AI draft'), 'AI: confirmed summary goes into the letter');

await rp.evaluate("navigator.share = undefined; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }");
await rp.click('#copy');
const copiedReport = await rp.evaluate('window.__copied');
check(copiedReport.startsWith('To,') && copiedReport.includes('Total amount lost: Rs 11,499.50'), 'report: Copy gives the full letter as text');
await rp.click('#next-toggle');
check(await rp.locator('#next').isVisible() && (await rp.locator('#next ol.steps li').count()) === 5, "'See the exact next steps' shows five steps");
check((await rp.getAttribute('#next-toggle', 'aria-expanded')) === 'true', 'next steps toggle reports its state');
if (SHOTS) await rp.screenshot({ path: `${SHOTS}/report-filled.png`, fullPage: true });
await rp.click('#clear');
check((await rp.inputValue('#story')) === '' && await rp.locator('#preview').isHidden() && (await rp.locator('#doc').innerText()) === '', 'Clear everything empties the page');
await rctx.close();

// Without on-device speech, the mic asks first and does nothing on "Type instead".
const cctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await cctx.addInitScript(fakes, { onDevice: false });
const cp = await cctx.newPage();
await cp.goto(`${BASE}/hi/report/`);
await cp.locator('#mic').waitFor();
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
check(await cp.locator('#ai').isHidden(), 'AI: no AI summary on Hindi pages (on-device models are English-only)');
await cp.fill('#sms', SMS);
await cp.click('.report-form > button.primary');
await cp.locator('#doc').waitFor();
check((await cp.innerText('#doc')).includes('विषय: Rs 13,499.50 की ऑनलाइन वित्तीय धोखाधड़ी की शिकायत'), 'report: Hindi letter');
await cctx.close();

const csp = errors.filter((e) => e.includes('Content Security Policy') || e.includes('Refused'));
check(!csp.length, `no CSP violations (${csp.slice(0, 2)})`);
check(!errors.length, `no console errors (${errors.slice(0, 3)})`);
await browser.close();

console.log(`\n${failures.length} failure(s)`);
process.exit(failures.length ? 1 : 0);
