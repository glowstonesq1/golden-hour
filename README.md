# Golden Hour

An installable web app for people in India who have just lost money to an online scam, or who are holding a message that feels wrong. It works in English, Hindi and Marathi, and **nothing you type, paste or share leaves your phone.**

- **Help** puts the 1930 cyber crime helpline one tap away, then walks through the next hour: block the card and UPI, finish the complaint on cybercrime.gov.in within 24 hours, tell the bank in writing, keep the proof. Every step links to its official source.
- **Check** receives a suspicious message shared from WhatsApp or Messages (Android), or pasted in. An on-device scam classifier is the next milestone; today the page lists the four signs that mean stop, and an "Ask my family" button sends the message to someone you trust.

Status: milestone 1 of 6. See [docs/m0-verification.md](docs/m0-verification.md) for the sources behind every rule.

## Why it is built this way

Speed decides whether money can be frozen, and the people who need this most are often panicking on a low-end phone. So:

- The 1930 button is plain HTML and works before any script loads, with JavaScript off, and offline.
- There is no backend. The app is static files; a service worker answers shares on the device, so a shared message never reaches a server or a URL.
- Strict Content-Security-Policy, no third-party scripts, fonts or analytics.
- Hindi and Marathi pages say plainly that they are machine translated and not yet reviewed.

## Run it locally

Needs Node.js 20 or newer. No dependencies to install.

```bash
npm run build      # writes dist/
npm test           # 12 checks on the built output
npm run serve      # http://127.0.0.1:8080
```

Browser checks (no-JS, offline, the share path, CSP violations) use Playwright:

```bash
pip install playwright && playwright install chromium
python3 tests/e2e.py http://127.0.0.1:8080
```

## Deploy to Vercel (free tier)

1. Create a public GitHub repository named `golden-hour` and push this folder to it.
2. In Vercel, choose Add New, then Project, and import the repository. Vercel reads `vercel.json`: build command `node build.mjs`, output folder `dist`, security headers included. Leave the framework preset as Other.
3. Deploy. Open the URL on an Android phone in Chrome and choose Install app. After installing, the app appears in the share menu of WhatsApp and Messages.

If the repository lives somewhere other than `github.com/glowstonesq1/golden-hour`, change `SOURCE_URL` in `build.mjs`.

## Project layout

```
build.mjs            generates every page, manifest and the service worker
src/strings/*.json   all text, one file per language (same keys in each)
static/              styles, app script, service worker template, icons
tests/               node:test checks, Playwright checks, local server
docs/                verification notes and sources
```

## Disclaimer

Golden Hour is an independent open-source project, not a government service and not legal advice. Always follow the 1930 operator, the police and your bank.

## Licence

MIT. Dataset credits will be listed here when the classifier ships.
