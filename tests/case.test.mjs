// Checks the case tracker: what may be stored, step order and kinds, and Latin digits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, sanitize, parseCase, nextStep, markDone, formatDate, formatAmount, isEmpty } from '../static/case-core.js';

test('only dates, the amount, reference numbers and the bank name survive', () => {
  const kept = sanitize({
    lossAt: '2026-10-28T14:30', amount: '13499.50', ack: '31910280012345', bankRef: 'HDFC/2026/88123', mrmId: 'MR2026AB1234',
    bank: 'State Bank of India', utrs: ['482910384756', 'SBIN226300112233', '482910384756'], done: { call: '2026-10-28' },
    // none of these may ever be stored
    name: 'Sunita Deshpande', mobile: '9123456780', pan: 'ABCDE1234F', account: '123456789012', card: '4111111111111111',
    otp: '482913', story: 'He called me', upi: 'refund221@ybl', scammer: '9876543210',
  });
  assert.deepEqual(kept, {
    lossAt: '2026-10-28T14:30', amount: '13499.50', ack: '31910280012345', bankRef: 'HDFC/2026/88123', mrmId: 'MR2026AB1234',
    bank: 'State Bank of India', utrs: ['482910384756', 'SBIN226300112233'], done: { call: '2026-10-28' },
  });
});

test('malformed values are dropped, not repaired', () => {
  assert.deepEqual(sanitize({
    lossAt: 'yesterday', amount: 'Rs 500', ack: '3191028001234', bankRef: 'x', mrmId: '2026AB', bank: 'Acct 123456789',
    utrs: ['12345', 'refund@ybl', 42], done: { call: 'today', hack: '2026-10-28' },
  }), {});
  assert.deepEqual(sanitize(null), {});
  assert.deepEqual(parseCase('{not json'), {});
  assert.deepEqual(parseCase('{"amount":"500","name":"X"}'), { amount: '500' });
  assert.ok(isEmpty({ name: 'only junk' }));
});

test('journey order, and the portal step is a suggestion that never shows as late', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['call', 'proof', 'block', 'portal', 'bank', 'claim', 'back']);
  assert.equal(STEPS.find((s) => s.id === 'portal').kind, 'suggest');
  assert.ok(STEPS.every((s) => !('deadline' in s)), 'no step carries an official deadline');
});

test('next step is the first not done; claim is skipped until it applies', () => {
  assert.equal(nextStep({}), 'call');
  let c = markDone({}, 'call', true, '2026-10-28');
  assert.equal(nextStep(c), 'proof');
  for (const s of ['proof', 'block', 'portal', 'bank']) c = markDone(c, s, true, '2026-10-29');
  assert.equal(nextStep(c), 'back');
  c = markDone(c, 'back', true, '2026-11-20');
  assert.equal(nextStep(c), null);
  assert.equal(nextStep(markDone(c, 'block', false)), 'block', 'undo works');
});

test('dates and amounts render in Latin digits in every language', () => {
  for (const lang of ['en', 'hi', 'mr']) {
    const d = formatDate('2026-10-28', lang);
    assert.match(d, /28/, `${lang}: ${d}`);
    assert.doesNotMatch(d, /[०-९]/, `${lang}: ${d}`);
    assert.doesNotMatch(formatDate('2026-10-28T14:30', lang), /[०-९]/);
  }
  assert.equal(formatAmount('13499.5'), 'Rs 13,499.50');
});

test('payment dates from bank SMS become ISO dates, or nothing', async () => {
  const { toIso } = await import('../static/case-core.js');
  assert.equal(toIso('28-Oct-26'), '2026-10-28');
  assert.equal(toIso('28/10/2026 14:32'), '2026-10-28T14:32');
  assert.equal(toIso('2026-10-28'), '2026-10-28');
  assert.equal(toIso('28-10-26 02:05 pm'), '2026-10-28T14:05');
  assert.equal(toIso('31/02/2026'), '', 'impossible dates are refused');
  assert.equal(toIso('no date here'), '');
});

test('acknowledgement numbers: 14 digits; the first digit says portal or 1930', async () => {
  const { ackInfo } = await import('../static/case-core.js');
  assert.deepEqual(ackInfo('3191 0280 0123 45'), { ok: true, value: '31910280012345', kind: 'call' });
  assert.equal(ackInfo('21910280012345').kind, 'portal');
  assert.equal(ackInfo('51910280012345').kind, 'other', 'a 14-digit number with another prefix is kept but flagged');
  for (const bad of ['', '1234', '319102800123456', '3191028001234a', 'MR2026AB1234']) assert.equal(ackInfo(bad).ok, false, bad);
});
