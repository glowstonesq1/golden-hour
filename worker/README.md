# Golden Hour link checker (optional)

A Cloudflare Worker that tells someone where a suspicious link really goes, without opening it on their phone. The app works fully without it: if it is not deployed, over its daily cap or down, the Check screen shows the on-device result and says so.

## What it receives and does

- Only on tap, after a consent line: one link, reduced to scheme, host and path. The app strips the query string and fragment, and the worker strips them again.
- It follows redirects itself (at most 10), checking every hop: http and https only, no credentials, ports 80/443/8080/8443, and every DNS answer (looked up over DNS-over-HTTPS) must be a public address. Private, loopback, link-local (including 169.254.169.254), CGNAT, multicast, reserved and documentation ranges are refused, for IPv4 and IPv6, including IPv4 inside IPv6.
- An app file (.apk) or another download is recorded as a signal and never fetched past its headers.
- A web page is opened in Cloudflare Browser Rendering with downloads denied and every request the page makes checked the same way. It returns a screenshot, the final address, the redirect chain, and signals: a form asking for an OTP, UPI PIN, card number or CVV, or Aadhaar; a password field that posts to another site; the domain's age from RDAP.
- Limits: 10 checks per visitor per day (counted against a salted daily hash of the IP, never the IP) and a global budget of browser seconds per day (540 by default), kept in KV. KV is eventually consistent, so both are approximate.
- No logging: the worker writes no logs and `observability` is off. Cloudflare's own platform may keep its standard request records.

## Known limits

- DNS rebinding: the browser resolves names itself, so a name that answers differently to the browser than to the DNS-over-HTTPS check is a gap. Cloudflare's network does not route to private addresses from Workers, which narrows it.
- The top-sites list (`src/top-sites.js`) is empty until generated; until then `inTopList` is `null` and is never shown to the person.
- Scam pages can show checkers a harmless page. The app always says a clean scan only means "we could not confirm it is safe".

## Deploy (Cloudflare free plan)

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create LIMITS
```

Put the namespace id it prints into `wrangler.toml` (`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`), and set `ALLOWED_ORIGIN` to the app's exact origin. Then:

```bash
npx wrangler secret put SALT
npx wrangler deploy
```

`SALT` is any long random string; it makes the per-visitor counter unlinkable to an IP. Browser Rendering must be available on the account.

Finally, connect the app:

1. In `build.mjs`, set `WORKER_ORIGIN` to the worker's origin (for example `https://golden-hour-link-check.<account>.workers.dev`).
2. Copy the resulting policy (`node -e "import('./build.mjs').then(m => console.log(m.CSP_META))"` prints it) into the `Content-Security-Policy` header in `vercel.json`, keeping `frame-ancestors 'none'; upgrade-insecure-requests` at the end. `npm test` fails until the two match.
3. Optionally fill the top-sites list: `npm run top-sites` (needs network).

## Tests

`npm test` in the repository root runs `worker/test/worker.test.mjs` with local stubs (no Cloudflare, no network, no browser).
