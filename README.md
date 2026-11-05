# Golden Hour

**Share your screenshots. We build your case, walk you through filing it, and help you claim the money back. Nothing personal leaves your phone.**

An installable web app (no app store) for people in India who have just lost money to an online scam, or who are holding a message that feels wrong. English, Hindi and Marathi.

## Why recovery

Money is often frozen after a fraud is reported, but little of it comes back to victims. A widely repeated figure, attributed to the Ministry of Home Affairs when it launched the Money Restoration Module, is that of about Rs 7,647 crore frozen between April 2021 and November 2025, only about Rs 167 crore (about 2%) was returned, against more than Rs 52,969 crore reported lost ([as reported here](https://g.indiacustomercare.com/mrm-portal-for-cyber-fraud-money-recovery)). We have not traced it to an official document, and a Lok Sabha reply cited elsewhere gives different totals (Rs 8,189 crore frozen of Rs 55,050 crore lost, 2021 to 2025; [as reported here](https://cyberdefence.org.in/blog/cyber-fraud-statistics-india-2026/)). Either way, the gap is recovery. The app shows neither figure until an official source is found.

## What it does

- **I lost money**: one journey of seven steps, with the 1930 button always first.
  1. **Call 1930 now**, with a "have this ready" card (amount, date, UTRs, bank, the scammer's number or UPI ID) that can be read aloud with an on-device voice, and a field for the acknowledgement number from the SMS.
  2. **Add your proof** with no typing: share screenshots or a WhatsApp chat export to the app (Android), or choose them (iPhone, desktop). Screenshots are read on the phone; each value found is a card with the line it came from, and only values marked Correct enter the case. The total is computed in code.
  3. **Block card and UPI.**
  4. **Finish the complaint on cybercrime.gov.in**, a stage-by-stage walk-through with the case's values ready to copy, evidence images made smaller than 5 MB, and the acknowledgement number checked.
  5. **Tell your bank in writing**: a prefilled email (block, treat as unauthorised or fraud, give a complaint number) and the bank's reference saved.
  6. **Was your money held? Claim it** on the Money Restoration portal, with a have-ready checklist and the refund request ID saved, and a plain warning that no genuine helper charges a fee.
  7. **Money back.**

  A formal complaint letter for the police or the bank is an output of the case (print or save as PDF, copy, share).
- **Check a link or message**: on-device rules give one of three verdicts (likely scam, be careful, no common scam signs found; never "safe"), the scam type, the one rule that breaks it and up to three reasons. Link signals include shorteners, look-alike brand domains and punycode, bare IP addresses, risky TLDs, free hosting and app files. Optionally, and only on tap, a cloud check shows where a link really goes (see below). "Ask my family", "I already paid" and Chakshu for reporting when no money was lost.
- **Install app**: on Chrome and Android the browser's own install prompt; elsewhere, short Add to Home Screen instructions.

## What runs where

| On the phone, always | Sent off the phone, only if the person chooses |
| --- | --- |
| Every page, the 1930 button (plain HTML, works with JavaScript off and offline) | A link, without anything after `?` or `#`, to the optional link checker, after a consent line |
| Message rules, link signals, verdicts | Voice for the complaint letter, to Google or Apple, only when the phone cannot do speech on the device, and only after a warning |
| Reading screenshots (vendored Tesseract.js, no CDN), chat exports, extraction | |
| The case in localStorage (`gh-case-v1`): only dates, the amount, reference numbers and the bank's name, enforced by an allow-list | |

Screenshots, chats and images are processed in memory and never saved, cached or uploaded; shares wait in the service worker's memory and are handed over once. There are no accounts, cookies, ads or analytics, and no third-party scripts or fonts.

## Run it locally

Needs Node.js 20 or newer. No dependencies to install for the app.

```bash
npm run build      # writes dist/
npm test           # unit tests: build, case, rules, proof, report, banks, service worker, worker
npm run serve      # http://127.0.0.1:8080
```

Browser checks use Playwright. With the server running:

```bash
npm install --no-save playwright && npx playwright install chromium
```

```bash
npm run e2e
```

OCR accuracy on synthetic screenshots (needs Playwright and a served `dist/`):

```bash
node eval/ocr.mjs http://127.0.0.1:8080
```

## The optional link checker

`worker/` is a Cloudflare Worker (free plan, Browser Rendering) that follows a link's redirects with an SSRF guard on every hop, opens the final page in a browser far from the phone, and returns a screenshot and signals: a form asking for an OTP, UPI PIN, card or CVV, or Aadhaar; a password field posting to another site; an app download; the domain's age. It has per-visitor and daily browser-time limits and keeps no logs (Cloudflare's own platform records still apply). Deploy steps, including the one constant and the CSP header to update in this repository, are in [worker/README.md](worker/README.md). Until it is deployed the Check screen does not offer it, and if it is down or over its cap the app says so and keeps the phone's result.

## How well it works

All numbers come from synthetic data written by the same person who wrote the rules. None has been checked on real people's messages or screenshots. Full results: [eval/results.md](eval/results.md); data and its limits: [data/DATA_CARD.md](data/DATA_CARD.md).

**Message check** (synthetic test set, 138 messages from 39 templates):

| Run | Scams flagged | Called likely scam | False alarms on genuine messages |
| --- | --- | --- | --- |
| First run, rules never tuned on test | 94.7% | 77.6% | 0 of 62 |
| After fixing the bug that run exposed | 100% | 82.9% | 0 of 62 |

A code review found mistakes this set could not catch (for example "don't worry, just share the OTP" was missed, and links to rbi.org.in were flagged). They were fixed and are guarded by a separate review set that is not held out. The v2 link signals changed no result on these sets.

**Reading screenshots** (30 clean rendered images; on formats the rules were written for, then on formats they were not):

| Images | Fields found exactly | OCR character error rate |
| --- | --- | --- |
| Dev (15) | 52 of 57 | 1.5% |
| Test (15, not tuned on) | 27 of 60 (45%) | 0.6% |

The OCR reads clean screenshots well; the extraction rules miss formats they were not written for (an Axis multi-line alert, payment-app receipts, Hindi and Marathi receipts). Real screenshots, with compression and other fonts, will do worse.

## Honest limits

- iPhone has no share menu for web apps; iPhone users choose screenshots instead.
- Hindi and Marathi are machine translated and not yet reviewed by a native speaker; the pages say so.
- Several official facts could not be checked from the build workspace (the NCRP portal flow and field names, the Money Restoration Module steps and timelines, RBI's 2017 liability rule, every bank's fraud contact). The app labels them "as reported", keeps the wording general, and lists them in [docs/m0-verification.md](docs/m0-verification.md) and [docs/ncrp-walkthrough.md](docs/ncrp-walkthrough.md) for the maintainer to confirm.
- `data/banks.json` lists no banks yet: an entry needs a source on the bank's own site. Until then everyone is sent to the bank's own app or the number on their card, never a searched number.
- The link checker is written and tested against local stubs only; it has not been deployed.
- The app never submits anything for anyone: no automation of cybercrime.gov.in, the Money Restoration portal, Chakshu or any bank, and no OTP or CAPTCHA handling.

## Deploy the app to Vercel (free tier)

1. Push this repository to GitHub.
2. In Vercel, choose Add New, then Project, and import it. Vercel reads `vercel.json`: build command `node build.mjs`, output folder `dist`, security headers included. Leave the framework preset as Other.
3. Deploy. Open the URL on an Android phone in Chrome and choose Install app; the app then appears in the share menu of WhatsApp, Gallery and Files.

If the repository lives somewhere other than `github.com/glowstonesq1/golden-hour`, change `SOURCE_URL` in `build.mjs`.

## Project layout

```
build.mjs            generates every page, manifest and the service worker; validates data/banks.json
src/strings/*.json   all text, one file per language (identical keys, enforced by a test)
static/              app script, journey (report.js), case tracker, proof, portal copilot, rules, styles, service worker
static/vendor/       Tesseract.js, its core and language data (Apache-2.0; versions and checksums in its README)
worker/              the optional Cloudflare link checker, with its own tests and deploy guide
data/                synthetic generators, frozen sets, banks.json, data card
eval/                scores the rules and the OCR, writes results.md
tests/               node:test checks, Playwright checks, local server
docs/                verification notes, sources, the NCRP checklist
```

## Disclaimer

Golden Hour is an independent open-source project, not a government service and not legal advice. Always follow the 1930 operator, the police and your bank.

## Licence

MIT. Tesseract.js, tesseract.js-core and tessdata_fast are Apache-2.0 (see `static/vendor/README.md`). Datasets and their credits are listed in [data/DATA_CARD.md](data/DATA_CARD.md).
