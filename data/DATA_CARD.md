# Data card

Every message used to build or test Golden Hour comes from public datasets, official advisories, or hand-written templates with fake values. No real user's messages are collected, ever.

Checked on 29 Oct 2026. Results for each set are in [eval/results.md](../eval/results.md).

## Sets

| Set | Source and licence | Count | Status |
| --- | --- | --- | --- |
| Synthetic dev | Hand-written templates in `synthetic/generate.mjs`, this repo, MIT | 132 messages from 37 templates (76 scam, 56 genuine) | Frozen. Used to tune rules |
| Synthetic test | Same generator, different templates | 138 messages from 39 templates (76 scam, 62 genuine) | Frozen. Scored, never tuned on, except once (see below) |
| Review | Hand-written in `review/review.jsonl`, this repo, MIT | 26 (11 scam, 15 genuine) | Cases code review showed the first rules got wrong (OTP requests with "don't worry", delivery OTPs, real RBI/SBI Card/HDFC links, links glued to text). Used to fix the rules, so **not held out**; `npm test` keeps them fixed |
| Advisory | Scam texts quoted in official advisories from I4C, RBI, banks and Sanchar Saathi | 0 | **Not collected yet.** Needs a machine that can reach those sites |
| UCI SMS Spam Collection | [UCI 228](https://archive.ics.uci.edu/dataset/228/), CC BY 4.0, Almeida and Hidalgo (2011), DOI 10.24432/C5CC84 | 5,574 (only the genuine "ham" half is scored) | **Not downloaded yet.** Blocked from the build workspace |
| Hinglish scam dataset | [bolewara/hinglish-scam-text-dataset](https://huggingface.co/bolewara/hinglish-scam-text-dataset), CC BY 4.0, Anuj Bolewar | 3,787 (35 Hinglish scam) | Not used yet; its English part duplicates UCI |
| Hindi Spam SMS | IEEE DataPort, licence not stated | 3,894 | Skipped: files not available, licence unknown |

The synthetic counts come from `node data/synthetic/generate.mjs`. `npm test` fails if the committed files drift from the generator.

## Honest limits

- **The same person wrote the rules and the synthetic test set.** The test templates were committed before any rule existed (see git history), but the author knew the scam patterns while writing both. Synthetic scores are an upper bound, not a forecast.
- **The effective sample size is the number of templates, not messages.** Four fills of one template differ only in amounts, names and links, so 76 scam messages are closer to 22 independent examples in the test set.
- **The test set was looked at once.** The first test run missed one template (a tax refund with a decimal amount). That exposed a general bug (decimal points ended the sentence windows), which was fixed. Both runs are recorded in the README.
- **Hindi and Marathi templates were written by the same author, not native speakers,** like the app's own Hindi and Marathi text.
- **The synthetic genuine set missed whole classes of real messages.** Code review found delivery OTPs, "pin code" requests, referral codes and links to real RBI, NPCI, SBI Card and HDFC domains all wrongly called "likely scam", while the synthetic test set still showed 0 false alarms. A clean synthetic score is weak evidence; the review set now guards those cases.
- Public spam datasets are mostly promotions, not fraud, and are not Indian. They only measure false alarms on real genuine messages.

## How to add the missing sets (on your own machine)

**UCI.** Download `sms+spam+collection.zip` from the UCI page and put `SMSSpamCollection` in `data/public/`. That folder is git-ignored. Then run `node eval/run.mjs`.

**Advisory set.** Create `data/advisory/advisory.jsonl`, one JSON object per line:

```json
{"id": "rbi-2025-03-1", "label": "scam", "type": "kyc", "lang": "en", "text": "<the scam text exactly as quoted>", "source_url": "https://...", "checked": "2026-11-02"}
```

`type` is one of: kyc, arrest, parcel, bill, job, invest, loan, prize, otp, family, threat. `eval/run.mjs` rejects rows without an https `source_url` or with an unknown type.

Collection rules (scrapling-official): obey robots.txt, throttle requests, never use Cloudflare-solving or stealth modes on government or bank sites, and never collect anything behind a login or CAPTCHA. Copy only texts the advisory itself quotes as scam examples. Never copy public posts of people's real messages.
