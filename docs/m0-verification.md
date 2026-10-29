# Milestone 0: verification notes

Checked on 29 Oct 2026. Every rule the app shows must trace back to a line here or to a newer check.

## RBI customer protection directions (the 2027 framework)

Source: [RBI press release, 24 Jun 2026](https://www.rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=63011) and the [Commercial Banks Third Amendment Directions, 2026](https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=13543&Mode=0). Separate notifications exist for small finance, payments, local area, regional rural, urban co-operative and rural co-operative banks (Ids 13544 to 13549).

- Applies to electronic banking transactions made on or after **1 January 2027** (section 3(2)).
- A "fraudulent" transaction now includes one the customer approved **under coercion or duress** from a third party (4(15A)). Impersonation is not named separately.
- **Bank negligence:** zero customer liability, reported or not (76L).
- **Third-party breach** (an app, gateway or telecom provider at fault): zero liability if reported within **5 calendar days** (76M).
- **Customer negligence** (shared OTP, ignored bank warnings, installed a malicious app): customer bears the loss until reporting, except for the small-value compensation below (76N).
- **Bank timelines:** immediate acknowledgement with a complaint number (76I); resolution within **45 calendar days** domestic, **60** cross-border (76Q); reversal value-dated to the original transaction (76R); burden of proof on the bank (76K).
- **Small-value compensation** (76T, 76U): individuals with a gross loss up to **Rs 50,000**; pays **85% of net loss or Rs 25,000, whichever is less**; once per lifetime; the fraud must be reported **to the bank and to 1930 or cybercrime.gov.in within 5 calendar days**; the bank pays within 5 days of the application.

Re-check before release: these figures came from a fetched summary of the notification page. Read the PDF of the notification once more before the 2027 content goes live.

How the app uses this: Help shows one plain rule, "For frauds from 1 January 2027: tell your bank and 1930 within 5 days. Small losses may be compensated." It does not promise eligibility.

## 1930 and cybercrime.gov.in

- Call 1930 for financial fraud; it triggers the freeze request through CFCFRMS ([Moneylife](https://moneylife.in/article/fraud-alert-use-golden-hour-to-report-scam-and-increase-your-chances-to-get-money-back/74091.html)).
- Details asked on the call: mobile number, bank or wallet debited, account or UPI ID debited, transaction ID (12-digit UTR), date, amount ([Canara Bank advisory](https://canarabank.com/UploadedFiles/Pdf/(57)%20Special%20Advisory%20Cyber%20Jagrookta%20Divas-April%202023.pdf)).
- After the 1930 acknowledgement, the complaint must be completed on cybercrime.gov.in **within 24 hours** ([NICDC citizen instructions](https://nicdc.in/images/instructions_citizenreportingcyberfrauds_nw.pdf)).
- Portal form parts: incident details, suspect details, complainant details, preview and submit. Evidence files up to 10 MB each.
- No money lost yet: report the call or message on Chakshu at sancharsaathi.gov.in/sfc instead ([Sanchar Saathi notice](https://www.sancharsaathi.gov.in/SancharSaathiDocuments/KeepYourselfAwareDocuments/FraudLoanApps.pdf)).

## Datasets

| Dataset | Licence | Size | Status |
| --- | --- | --- | --- |
| [SMS Spam Collection (UCI)](https://archive.ics.uci.edu/dataset/228/) | CC BY 4.0, cite Almeida and Hidalgo (2011), DOI 10.24432/C5CC84 | 5,574 messages | Usable |
| [Hinglish scam dataset](https://huggingface.co/bolewara/hinglish-scam-text-dataset) | CC BY 4.0, attribute Anuj Bolewar | 3,787 (35 Hinglish scam) | Usable; English part duplicates UCI, so dedupe |
| [Hindi Spam SMS (IEEE DataPort)](https://ieee-dataport.org/documents/spam-sms-hindi-language) | Not stated on page | 3,894 | Files not uploaded; skip unless they appear |

## Not done here, and why

- Quick Heal Victim Support and Google's scam warnings need a real phone; Kaif should try both once and note what they cover.
- reverse-engineer-anything applies to shipped binaries and packages. No such artifact is in scope yet; it becomes relevant if we inspect a competitor's APK.
