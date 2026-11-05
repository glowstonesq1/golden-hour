# Golden Hour link checker (optional)

A Cloudflare Worker that tells someone where a suspicious link really goes, without opening it on their phone. The app works fully without it: if it is not deployed, over its daily cap or down, the Check screen shows the on-device result and says so.

## What it receives and does

- Only on tap, after a consent line: one link, reduced to scheme, host and path. The app strips the query string and fragment, and the worker strips them again.
- It follows redirects itself (at most 10), checking every hop: http and https only, no credentials, ports 80/443/8080/8443, and every DNS answer (looked up over DNS-over-HTTPS) must be a public address. Private, loopback, link-local (including 169.254.169.254), CGNAT, multicast, reserved and documentation ranges are refused, for IPv4 and IPv6, including IPv4 inside IPv6.
- An app file (.apk) or another download is recorded as a signal and never fetched past its headers.
- A web page is opened in Cloudflare Browser Rendering with downloads denied. Every HTTP request the page makes (frames, scripts, images) is checked the same way, ports included. Connections that request interception cannot see are switched off before any page script runs: WebSocket, WebRTC, WebTransport and workers. The page gets at most 20 seconds, reserved from the daily budget before launch so a page that hangs is still charged. It returns a screenshot, the final address, the redirect chain, and signals: a form asking for an OTP, UPI PIN, card number or CVV, or Aadhaar; a password field that posts to another site; the domain's age from RDAP.
- Limits: 10 checks per visitor per day (counted against a salted daily hash of the IP, never the IP; IPv6 per /64) and a global budget of browser seconds per day (540 by default), kept in KV. Every outside call times out after 5 seconds, and if KV cannot be read the worker refuses rather than running without limits.
- No logging: the worker writes no logs and `observability` is off. Cloudflare's own platform may keep its standard request records.

## Known limits

- DNS rebinding: the worker checks names over DNS-over-HTTPS, but `fetch` (for each redirect hop) and the browser (for each page request) look the name up again themselves. A name that answers differently the second time is a gap. How far it matters depends on what Workers and Browser Rendering can reach on Cloudflare's network, which should be confirmed before relying on the guard alone.
- The limits are approximate: KV is eventually consistent and not atomic, so parallel requests can slip past them. Cloudflare's Rate Limiting binding or a Durable Object would make them exact; that is the next step if the worker is abused.
- The origin allow-list only stops browsers. Any script can send the app's `Origin` header, so anyone can use the worker as a redirect follower and screenshotter within its limits. A Turnstile check would close this, at the cost of a step for the person.
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
