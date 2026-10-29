// Checks the Check v1 rule layer, the frozen test sets and the published targets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { check, findLinks } from '../static/rules.js';
import { generate, toJsonl } from '../data/synthetic/generate.mjs';
import { run, score, parseUci, validateAdvisory, TYPE_KEYS } from '../eval/run.mjs';

const strings = JSON.parse(await readFile(new URL('../src/strings/en.json', import.meta.url), 'utf8'));

test('verdict is always one of three, never "safe", and handles empty or odd input', () => {
  for (const input of ['', '   ', null, undefined, 42, 'hello', 'a'.repeat(50000)]) {
    const out = check(input);
    assert.ok(['likely', 'careful', 'none'].includes(out.verdict), String(input).slice(0, 20));
    assert.ok(Array.isArray(out.signs));
  }
  assert.equal(check('').verdict, 'none');
  assert.equal(check('').type, null);
});

test('every type and sign the rules can return has text in every language', async () => {
  for (const lang of ['en', 'hi', 'mr']) {
    const s = JSON.parse(await readFile(new URL(`../src/strings/${lang}.json`, import.meta.url), 'utf8')).check;
    for (const t of [...TYPE_KEYS, 'unknown']) assert.ok(s.types[t]?.name && s.types[t]?.rule, `${lang}: type ${t}`);
    for (const k of ['apk', 'screenShare', 'otpAsk', 'collect', 'lookalike', 'shortLink', 'unknownLink', 'money', 'urgency']) {
      assert.ok(s.signNames[k], `${lang}: sign ${k}`);
    }
    for (const v of ['likely', 'careful', 'none']) assert.ok(s.verdicts[v]?.title, `${lang}: verdict ${v}`);
  }
  for (const lang of ['en', 'hi', 'mr']) {
    const s = JSON.parse(await readFile(new URL(`../src/strings/${lang}.json`, import.meta.url), 'utf8')).check;
    for (const v of Object.values(s.verdicts)) assert.doesNotMatch(v.title, /safe|सुरक्षित/i, `${lang}: ${v.title}`);
  }
});

test('asking for an OTP is a hard sign; a genuine "do not share" OTP is not', () => {
  assert.equal(check('Please share the OTP you just received to stop the transaction').verdict, 'likely');
  assert.equal(check('jo OTP aaya hai woh batao').verdict, 'likely');
  assert.equal(check('482913 is your OTP for login. Do not share OTP with anyone.').verdict, 'none');
  assert.equal(check('Never share your OTP, PIN or password with anyone.').verdict, 'none');
  assert.equal(check('482913 हा तुमचा OTP आहे. तो कोणालाही सांगू नका.').verdict, 'none');
});

test('links: official domains pass, lookalikes, shorteners and .apk files do not', () => {
  assert.deepEqual(findLinks('Track: https://amzn.in/d/abc, pay rk12@okaxis or mail a@b.com'), [{ host: 'amzn.in', path: '/d/abc', userinfo: false }]);
  assert.deepEqual(findLinks('KYC:https://onlinesbi.sbi@evil.xyz/a?x=b@c').map((l) => [l.host, l.userinfo]), [['evil.xyz', true]]);
  assert.equal(check('Track your order: https://amzn.in/d/xyz').verdict, 'none');
  assert.equal(check('Login at https://www.onlinesbi.sbi or https://sbi.bank.in').verdict, 'none');
  assert.ok(check('Update now https://sbi-kyc-update.com/x').signs.includes('lookalike'));
  assert.ok(check('Visit indiapost-gov.in now').signs.includes('lookalike'));
  assert.ok(check('Open http://192.168.4.20/login').signs.includes('lookalike'));
  assert.ok(check('see bit.ly/abc123').signs.includes('shortLink'));
  assert.equal(check('Download http://quickloan12.in/App.apk').verdict, 'likely');
  assert.deepEqual(findLinks('Rs.1,499.00 on 29-Oct-26 e.g. today.Click'), []);
});

test('amounts with decimals do not break sentence-bounded patterns', () => {
  assert.equal(check('Income Tax Refund of Rs 1,499.00 approved. Verify here https://claim-now.xyz/a').verdict, 'likely');
});

test('Hindi and Marathi scams are recognised', () => {
  assert.equal(check('आपका बिजली कनेक्शन आज रात काट दिया जाएगा। तुरंत संपर्क करें 9876543210').type, 'bill');
  assert.equal(check('अभिनंदन! तुम्ही लॉटरीमध्ये ₹10,00,000 जिंकले आहात').type, 'prize');
});

test('review set: every scam found in code review is likely, no genuine message is', async () => {
  const rows = (await readFile(new URL('../data/review/review.jsonl', import.meta.url), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  for (const r of rows) {
    const { verdict } = check(r.text);
    if (r.label === 'scam') assert.equal(verdict, 'likely', `${r.id}: ${r.text}`);
    else assert.notEqual(verdict, 'likely', `${r.id}: ${r.text}`);
  }
});

test('the committed test sets are frozen: the generator still produces them byte for byte', async () => {
  const sets = generate();
  for (const split of ['dev', 'test']) {
    const committed = await readFile(new URL(`../data/synthetic/${split}.jsonl`, import.meta.url), 'utf8');
    assert.equal(toJsonl(sets[split]), committed, `${split}.jsonl changed; regenerate only on purpose`);
  }
  const devTemplates = new Set(sets.dev.map((r) => r.template));
  assert.ok(sets.test.every((r) => !devTemplates.has(r.template)), 'a template appears in both splits');
});

test('targets on the synthetic test set: false alarms under 2%, every type represented', async () => {
  const { sets } = await run('test');
  const [, s] = sets[0];
  assert.ok(s.genuine.falseAlarm / s.genuine.n < 0.02, `false alarms ${s.genuine.falseAlarm}/${s.genuine.n}`);
  for (const t of s.perType) assert.ok(t.n > 0, `no test messages for ${t.type}`);
});

test('eval loaders: UCI keeps only ham; advisory rows need a source and a known type', () => {
  assert.deepEqual(parseUci('ham\tSee you at 5\nspam\tWIN a prize\n').map((r) => r.text), ['See you at 5']);
  assert.throws(() => validateAdvisory([{ id: 'a', label: 'scam', type: 'kyc', text: 'x' }]), /source_url/);
  assert.throws(() => validateAdvisory([{ id: 'a', label: 'scam', type: 'nope', text: 'x', source_url: 'https://rbi.org.in/' }]), /type/);
  const s = score([{ id: '1', label: 'genuine', text: 'See you at 5' }, { id: '2', label: 'scam', type: 'otp', text: 'share the OTP now' }]);
  assert.equal(s.genuine.falseAlarm, 0);
  assert.equal(s.scam.likely, 1);
});
