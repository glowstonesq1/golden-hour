# Golden Hour

An installable web app for people in India who have just lost money to an online scam, or who are holding a message that feels wrong. It works in English, Hindi and Marathi, and **nothing you type, paste or share leaves your phone.**

- **Help** puts the 1930 cyber crime helpline one tap away, then walks through the next hour: block the card and UPI, finish the complaint on cybercrime.gov.in within 24 hours, tell the bank in writing, keep the proof. Every step links to its official source.
- **Check** receives a suspicious message shared from WhatsApp or Messages (Android), or pasted in, and checks it on the phone. It gives one of three verdicts (likely scam, be careful, no common scam signs found; never "safe"), names the scam type, shows the one rule that breaks it and the signs it found. "Ask my family" sends the message and the verdict to someone you trust; "I already paid" jumps to Help.

Status: milestones 0, 1 and 3 done; milestone 2 (data) is half done, because the advisory and public sets have to be collected on a machine that can reach those sites. See [docs/m0-verification.md](docs/m0-verification.md) for the sources behind every Help step and [data/DATA_CARD.md](data/DATA_CARD.md) for the data.

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
npm test           # build, service worker, rules, frozen data and target checks
npm run serve      # http://127.0.0.1:8080
```

Browser checks (no-JS, offline, the share path, Check verdicts in three languages, CSP violations) use Playwright. With the server running:

```bash
npm install --no-save playwright && npx playwright install chromium
```

```bash
node tests/e2e.mjs http://127.0.0.1:8080
```

## How well Check works

The Check rules live in `static/rules.js` and run unchanged in the browser and in Node. `node eval/run.mjs` scores them and writes [eval/results.md](eval/results.md).

On the synthetic test set (138 messages, 39 templates):

| Run | Scams flagged | Called likely scam | False alarms on genuine messages |
| --- | --- | --- | --- |
| First run, rules never tuned on test | 94.7% | 77.6% | 0 of 62 |
| After fixing the bug that run exposed | 100% | 82.9% | 0 of 62 |

Read these numbers sceptically. They come from synthetic data written by the same person who wrote the rules, and 76 scam messages come from only 22 templates. They have not been checked on real users' messages. The real test is the advisory set of scam texts quoted in official advisories, which is not collected yet (see the data card).

Known gaps: scams with no link and no explicit demand for money (a Hindi "CBI warrant" message, a "double your money" pitch) get "be careful", not "likely scam"; a scam that reads like an ordinary conversation gets "no common scam signs found", which is why that verdict always says it does not mean safe.

## Deploy to Vercel (free tier)

1. Create a public GitHub repository named `golden-hour` and push this folder to it.
2. In Vercel, choose Add New, then Project, and import the repository. Vercel reads `vercel.json`: build command `node build.mjs`, output folder `dist`, security headers included. Leave the framework preset as Other.
3. Deploy. Open the URL on an Android phone in Chrome and choose Install app. After installing, the app appears in the share menu of WhatsApp and Messages.

If the repository lives somewhere other than `github.com/glowstonesq1/golden-hour`, change `SOURCE_URL` in `build.mjs`.

## Project layout

```
build.mjs            generates every page, manifest and the service worker
src/strings/*.json   all text, one file per language (same keys in each)
static/              styles, app script, Check rules, service worker template, icons
data/                synthetic generator, frozen dev/test sets, data card
eval/                scores the rules on every test set, writes results.md
tests/               node:test checks, Playwright checks, local server
docs/                verification notes and sources
```

## Disclaimer

Golden Hour is an independent open-source project, not a government service and not legal advice. Always follow the 1930 operator, the police and your bank.

## Licence

MIT. Datasets and their credits are listed in [data/DATA_CARD.md](data/DATA_CARD.md).
