// Cloudflare Worker entry: wires the real fetch, browser, limits store and clock into handler.js.
// Deployed on its own (see worker/README.md); the app works fully without it.
import puppeteer from '@cloudflare/puppeteer';
import { handle } from './handler.js';
import { TOP_SITES } from './top-sites.js';

export default {
  fetch(request, env) {
    return handle(request, env, {
      fetch: (url, init) => fetch(url, init),
      kv: env.LIMITS,
      now: () => new Date(),
      topSites: TOP_SITES.size ? TOP_SITES : null,
      browse: (url, allow) => browse(env, url, allow),
    });
  },
};

// Opens the page in Browser Rendering with every request checked by `allow`, downloads denied and at
// most 10 redirects; returns a screenshot and a description of the page's forms (never their contents).
async function browse(env, url, allow) {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const cdp = await page.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
    let navigations = 0;
    let download = false;
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame() && ++navigations > 11) return req.abort('blockedbyclient');
      if (!(await allow(req.url()))) return req.abort('blockedbyclient');
      return req.continue();
    });
    page.on('response', (res) => {
      const type = res.headers()['content-type'] || '';
      if (res.request().isNavigationRequest() && /android\.package-archive|octet-stream|zip/.test(type)) download = true;
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    const forms = await page.evaluate(() => {
      const describe = (el) => ({
        type: el.type || '', name: el.name || '', id: el.id || '', placeholder: el.placeholder || '',
        autocomplete: el.autocomplete || '', ariaLabel: el.getAttribute('aria-label') || '',
        label: el.labels?.[0]?.textContent?.trim().slice(0, 80) || '',
      });
      const fields = (root) => [...root.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'hidden').map(describe);
      const list = [...document.forms].map((f) => ({ action: f.action || '', fields: fields(f) }));
      const loose = [...document.querySelectorAll('input, select, textarea')].filter((el) => !el.form && el.type !== 'hidden').map(describe);
      if (loose.length) list.push({ action: '', fields: loose });
      return list;
    }).catch(() => []);
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 55, encoding: 'base64' }).catch(() => null);
    return { url: page.url(), forms, screenshot, download };
  } finally {
    await browser.close();
  }
}
