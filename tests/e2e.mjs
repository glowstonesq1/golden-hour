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

const csp = errors.filter((e) => e.includes('Content Security Policy') || e.includes('Refused'));
check(!csp.length, `no CSP violations (${csp.slice(0, 2)})`);
check(!errors.length, `no console errors (${errors.slice(0, 3)})`);
await browser.close();

console.log(`\n${failures.length} failure(s)`);
process.exit(failures.length ? 1 : 0);
