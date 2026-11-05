// Checks the bank step: data/banks.json rules and the email to the bank in every language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateBanks, loadBanks } from '../build.mjs';
import { BANKS } from '../static/proof-core.js';
import { bankEmail, MAX_EMAIL_BODY } from '../static/report-core.js';

const names = BANKS.map(([n]) => n);
const good = { name: 'HDFC Bank', domains: ['hdfcbank.com'], email: 'x@hdfcbank.com', source: 'https://www.hdfcbank.com/fraud', checked: '2026-11-01' };

test('banks.json: every entry is a known bank, cites its own domain or rbi.org.in, and has a date', async () => {
  const list = await loadBanks();
  assert.ok(Array.isArray(list));
  for (const b of list) assert.ok(names.includes(b.name) && b.source.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(b.checked), b.name);
  const raw = JSON.parse(await readFile(new URL('../data/banks.json', import.meta.url), 'utf8'));
  assert.ok(raw.about.includes("bank's own website"), 'the file says how an entry is allowed in');
});

test('banks.json: the validator refuses guessed or badly sourced entries', () => {
  assert.deepEqual(validateBanks([good], names, '2026-11-05'), [good]);
  assert.doesNotThrow(() => validateBanks([{ ...good, source: 'https://www.rbi.org.in/x' }], names, '2026-11-05'), 'rbi.org.in is allowed');
  const bad = [
    [{ ...good, name: 'Some Random Bank' }, /unknown bank/],
    [{ ...good, source: 'https://hdfcbank.com.evil.example/fraud' }, /own domain/],
    [{ ...good, source: 'https://www.google.com/search?q=hdfc+fraud' }, /own domain/],
    [{ ...good, source: 'http://www.hdfcbank.com/fraud' }, /own domain/],
    [{ ...good, checked: '' }, /checked date/],
    [{ ...good, checked: '2027-01-01' }, /checked date/],
    [{ ...good, email: undefined, phone: undefined }, /no email or phone/],
    [{ ...good, email: 'not an email' }, /bad email/],
    [{ ...good, domains: [] }, /no domains/],
  ];
  for (const [entry, why] of bad) assert.throws(() => validateBanks([entry], names, '2026-11-05'), why, JSON.stringify(entry));
});

test('bank email: correct mailto encoding and the right content in every language', async () => {
  for (const lang of ['en', 'hi', 'mr']) {
    const t = JSON.parse(await readFile(new URL(`../src/strings/${lang}.json`, import.meta.url), 'utf8')).bank.email;
    const mail = bankEmail({ to: 'fraud@hdfcbank.com', amount: 'Rs 13,499.50', date: '28 October 2026', utrs: ['482910384756', '773829104857'], ack: '31910280012345' }, t);
    const url = new URL(mail.mailto);
    assert.equal(url.protocol, 'mailto:');
    assert.equal(decodeURIComponent(url.pathname), 'fraud@hdfcbank.com');
    const params = new URLSearchParams(mail.mailto.split('?')[1].replace(/\+/g, '%2B'));
    assert.equal(params.get('subject'), mail.subject, `${lang}: subject round-trips`);
    assert.equal(params.get('body'), mail.body, `${lang}: body round-trips, line breaks included`);
    assert.doesNotMatch(mail.mailto, /[\sऀ-ॿ]/, `${lang}: nothing unencoded in the link`);
    for (const want of ['Rs 13,499.50', '482910384756, 773829104857', '31910280012345', t.request, t.namePlaceholder]) assert.ok(mail.body.includes(want), `${lang}: ${want}`);
    assert.ok(mail.subject.includes('Rs 13,499.50') && mail.subject.includes('28 October 2026'));
  }
});

test('bank email: body stays under 1,800 characters even with many UTRs; nothing known is shown as unknown', async () => {
  const t = JSON.parse(await readFile(new URL('../src/strings/hi.json', import.meta.url), 'utf8')).bank.email;
  const utrs = Array.from({ length: 150 }, (_, i) => String(400000000000 + i));
  const mail = bankEmail({ amount: 'Rs 9,99,999.00', date: '28 अक्टूबर 2026', utrs, ack: '31910280012345', name: 'सुनीता', mobile: '9123456780' }, t);
  assert.ok(mail.body.length <= MAX_EMAIL_BODY, `${mail.body.length} characters`);
  assert.ok(mail.body.includes(utrs[0]) && mail.body.includes('अन्य'), 'first UTRs kept, the rest summarised');
  assert.ok(mail.body.includes('सुनीता') && mail.body.includes('9123456780'));
  assert.ok(mail.mailto.startsWith('mailto:?subject='), 'no bank email known: the person picks the address');
  const empty = bankEmail({}, t);
  assert.ok(empty.body.includes(t.notKnown) && empty.body.includes(t.namePlaceholder));
});
