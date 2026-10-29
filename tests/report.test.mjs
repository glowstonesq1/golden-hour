// Checks the report maker core: extraction, the verbatim rule, the AI-summary verifier and the letter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  splitMessages, extractPayments, extractContacts, unsupportedDetails, verbatim, totalLost, formatRs, buildReport, reportText,
} from '../static/report-core.js';

const SMS = [
  'Dear Customer, your A/c XX4821 is debited by Rs.12,000.00 on 28-Oct-26 trf to Ramesh Kumar Refno 482910384756. If not done by you, call 1800111109 -SBI',
  'Rs.1,499.50 debited from a/c **4821 on 28-Oct-26 to VPA refund221@ybl (UPI Ref No 773829104857). Not you? Call 18002586161 -HDFC Bank',
  'INR 500.00 credited to A/c no. XX4821 on 28-Oct-26 by UPI Ref no 112233445566',
].join('\n\n');

test('messages split on blank lines, or on lines when there are none', () => {
  assert.equal(splitMessages(SMS).length, 3);
  assert.deepEqual(splitMessages('a\nb\n\n'), ['a', 'b']);
  assert.deepEqual(splitMessages(''), []);
});

test('payments: debits only, every value copied word for word, own account masked', () => {
  const p = extractPayments(SMS);
  assert.equal(p.length, 2, 'the credit is left out');
  assert.deepEqual(p[0], { when: '28-Oct-26', amount: '12,000.00', mode: '', utr: '482910384756', to: 'Ramesh Kumar', from: 'XX4821' });
  assert.deepEqual(p[1], { when: '28-Oct-26', amount: '1,499.50', mode: 'UPI', utr: '773829104857', to: 'refund221@ybl', from: 'XX4821' });
  for (const row of p) for (const k of ['amount', 'utr', 'to']) if (row[k]) assert.ok(verbatim(row[k], SMS), `${k} not in source`);
  const full = extractPayments('Rs 900 debited from account 123456789012 to x@ybl');
  assert.equal(full[0].from, 'XX9012', 'a full account number is never kept');
});

test('NEFT UTRs, times and Hindi debit alerts are read', () => {
  const [p] = extractPayments('INR 25,000.00 debited from A/c XX1111 on 27/10/2026 at 14:32 via NEFT UTR SBIN226300112233 to Fast Traders');
  assert.equal(p.utr, 'SBIN226300112233');
  assert.equal(p.when, '27/10/2026 14:32');
  assert.equal(p.mode, 'NEFT');
  const [hi] = extractPayments('आपके खाता XX4821 से दिनांक 28-Oct-26 को रु. 2,000 डेबिट किए गए। यूपीआई संदर्भ 998877665544');
  assert.deepEqual([hi.amount, hi.utr, hi.from], ['2,000', '998877665544', 'XX4821']);
});

test('contacts: scammer numbers, UPI IDs, emails and links, not the person\'s own number', () => {
  const story = 'He called from +91 98765 43210 and 9876500001. Pay to refund221@ybl, mail help@sbi-care.in, open https://sbi-kyc-update.com/x. My number is 9123456780. Call 1930.';
  assert.deepEqual(extractContacts(story, '9123456780'),
    ['+91 98765 43210', '9876500001', 'refund221@ybl', 'help@sbi-care.in', 'https://sbi-kyc-update.com/x']);
  assert.deepEqual(extractContacts('Update KYC:https://bit.ly/abc now'), ['https://bit.ly/abc']);
});

test('AI summary verifier rejects any number, ID or link the person never gave', () => {
  const source = `${SMS}\nHe called from 9876543210 on 27 October.`;
  assert.deepEqual(unsupportedDetails('They took Rs 12000 and Rs 1,499.50 via refund221@ybl after calling from 9876543210 on 27 October.', source), []);
  assert.deepEqual(unsupportedDetails('They took Rs 15,000.', source), ['15000']);
  assert.deepEqual(unsupportedDetails('Paid to helpdesk@paytm via https://evil.example/x', source), ['helpdesk@paytm', 'https://evil.example/x']);
  assert.deepEqual(unsupportedDetails('No numbers here.', source), []);
});

test('total is computed in code from the payment amounts', () => {
  const total = totalLost(extractPayments(SMS));
  assert.equal(total, 13499.5);
  assert.equal(formatRs(total), 'Rs 13,499.50');
  assert.equal(totalLost([{ amount: '' }, { amount: 'abc' }]), 0);
});

test('the letter has every part, blanks to fill by hand, and the right request for each recipient', async () => {
  const t = JSON.parse(await readFile(new URL('../src/strings/en.json', import.meta.url), 'utf8')).report.doc;
  const d = {
    recipient: 'police', name: 'Sunita Deshpande', mobile: '9123456780', email: '', address: 'Pune', bank: 'SBI', ack: '',
    firstContact: '', channel: 'Phone call', typeName: 'KYC update or account block', story: 'He called me.', summary: '',
    payments: extractPayments(SMS), contacts: ['9876543210'], date: '29 October 2026',
  };
  const r = buildReport(d, t);
  assert.equal(r.subject, 'Subject: Complaint of online financial fraud of Rs 13,499.50');
  assert.equal(r.sections.length, 6);
  assert.ok(!r.sections.some((s) => s.title === t.s2ai), 'no AI section without a confirmed summary');
  const text = reportText(r);
  for (const want of ['To,', 'Respected Sir or Madam,', '"He called me."', '482910384756', 'refund221@ybl', 'Total amount lost: Rs 13,499.50',
    'Email: ________', t.requestPolice, '[ ] Screenshots of the transactions', t.declaration, t.footer]) {
    assert.ok(text.includes(want), `missing: ${want}`);
  }
  assert.ok(!text.includes('1930 helpline'), 'no 1930 line without a complaint number');

  const bank = reportText(buildReport({ ...d, recipient: 'bank', ack: '3191', summary: 'A short summary.', payments: [] }, t));
  assert.ok(bank.includes(`${t.toBank}, SBI`) && bank.includes(t.requestBank) && bank.includes('Complaint number: 3191.'));
  assert.ok(bank.includes(t.s2ai) && bank.includes(t.noPaymentsDoc) && bank.includes(t.subjectNoAmount));
});

test('every language has the strings the report script and letter use', async () => {
  for (const lang of ['en', 'hi', 'mr']) {
    const r = JSON.parse(await readFile(new URL(`../src/strings/${lang}.json`, import.meta.url), 'utf8')).report;
    for (const k of ['consentTitle', 'consentBody', 'consentYes', 'consentNo', 'aiRejected', 'needStory']) assert.ok(r[k], `${lang}: ${k}`);
    for (const k of ['to', 'subject', 'intro', 'requestPolice', 'requestBank', 'declaration', 'footer']) assert.ok(r.doc[k], `${lang}: doc.${k}`);
    assert.equal(r.next.length, 5, `${lang}: five next steps`);
  }
});
