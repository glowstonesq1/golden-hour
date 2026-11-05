# NCRP walk-through: what the maintainer must confirm on the live portal

The portal copilot (journey step 4) describes the cybercrime.gov.in financial fraud complaint in seven stages. Its wording is deliberately general, because the details below come from the owner's research of 4 November 2026 and **have not been confirmed by walking the live form**. The build workspace cannot reach cybercrime.gov.in.

Before launch, walk the real form once (as a test, stopping before Submit) and tick each line. Change `src/strings/*.json` (`portal.stages`, `portal.checked`) and this file if anything differs.

## Flow (as reported)

- [ ] Home page has "Register a complaint", then a choice for financial fraud.
- [ ] An "I Accept" step with terms comes before sign-in.
- [ ] Sign-in asks for state, email and mobile number, then an OTP and a CAPTCHA.
- [ ] The form has three parts in this order: incident details, suspect details, complainant details.
- [ ] Then "Preview and Submit", then "Confirm and Submit".
- [ ] The complaint ID arrives by SMS and email, and a PDF of the complaint can be downloaded.
- [ ] Uploads are limited to 5 MB per file. Which file types are accepted? (The evidence tool makes JPEGs; confirm JPEG is accepted.)

## Fields to record (not yet in the app, on purpose)

The app shows only general labels ("when, how much, the transaction ID (UTR) and your bank"). Record the exact field names and their order, and only then consider matching the copilot's labels to them:

- [ ] Incident details: the transaction table's columns (bank or wallet, transaction ID or UTR, date, time, amount, others?).
- [ ] Is there one row per transaction, and how are rows added?
- [ ] Suspect details: which fields exist (mobile number, UPI ID, bank account, website or URL, social media handle, others?).
- [ ] Complainant details: which fields are required.
- [ ] Is there a field for a 1930 acknowledgement number when completing a complaint registered by phone?

## Acknowledgement numbers (as reported)

- [ ] 14 digits.
- [ ] Portal complaints start with 2.
- [ ] Complaints registered by calling 1930 start with 3, and arrive by SMS from a sender ending in "NCRP" that asks the person to complete the complaint on cybercrime.gov.in.

The app accepts any 14-digit number, explains a leading 2 or 3, and asks the person to check a number with another first digit against the SMS. It refuses anything that is not 14 digits.

## What the app must never do (unchanged, whatever the form looks like)

- No filling or submitting the portal for the person, no hidden frames, no OTP or CAPTCHA handling.
- The person presses Submit on the official site themselves.
