// Checks proof handling: the ZIP reader, the WhatsApp chat parser, bank names and the cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';
import { listZip, zipTexts, parseWhatsApp, canonicalBank, findCards } from '../static/proof-core.js';

// A minimal ZIP writer for the tests: each entry stored (0) or deflated (8).
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, method } of files) {
    const raw = Buffer.from(data);
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const CHAT = 'Hi sir, pay processing fee to refund221@ybl now\nCall me on 98765 43210';

test('zip: stored and deflated .txt entries are read; media is skipped', async () => {
  const zip = makeZip([
    { name: 'WhatsApp Chat with Agent.txt', data: CHAT, method: 8 },
    { name: 'IMG-20261028-WA0001.jpg', data: 'not really a jpeg', method: 0 },
    { name: 'notes.txt', data: 'stored text', method: 0 },
  ]);
  assert.equal(listZip(zip).length, 3);
  assert.deepEqual(await zipTexts(zip), [
    { name: 'WhatsApp Chat with Agent.txt', text: CHAT },
    { name: 'notes.txt', text: 'stored text' },
  ]);
});

test('zip: corrupt, truncated, non-zip and oversized files are refused with an error', async () => {
  const good = makeZip([{ name: 'a.txt', data: 'hello', method: 8 }]);
  assert.throws(() => listZip(new Uint8Array(100)), /not a zip/);
  assert.throws(() => listZip(new TextEncoder().encode('just some text, not a zip at all')), /not a zip/);
  const badCd = good.slice();
  const cdAt = new DataView(badCd.buffer).getUint32(badCd.length - 6, true);
  badCd[cdAt] = 0;
  assert.throws(() => listZip(badCd), /corrupt central directory/);
  const truncated = makeZip([{ name: 'a.txt', data: 'x'.repeat(5000), method: 0 }]);
  const cut = new Uint8Array([...truncated.slice(0, 40), ...truncated.slice(truncated.length - 22 - 46 - 5)]);
  await assert.rejects(zipTexts(cut));
  const bomb = makeZip([{ name: 'big.txt', data: 'a'.repeat(6 * 1024 * 1024), method: 8 }]);
  await assert.rejects(zipTexts(bomb), /too large/, 'a text entry that inflates past 5 MB is refused');
});

test('WhatsApp: Android 12-hour lowercase am/pm with a narrow no-break space, DD/MM/YY', () => {
  const m = parseWhatsApp('28/10/26, 2:15 pm - Agent Rahul: Pay Rs 499 fee\n28/10/26, 2:16 pm - You: ok');
  assert.deepEqual(m.map((x) => [x.date, x.time, x.sender, x.text]), [
    ['2026-10-28', '14:15', 'Agent Rahul', 'Pay Rs 499 fee'],
    ['2026-10-28', '14:16', 'You', 'ok'],
  ]);
});

test('WhatsApp: DD/MM/YYYY with 24-hour times, multi-line messages and system lines', () => {
  const m = parseWhatsApp([
    '28/10/2026, 09:05 - Messages and calls are end-to-end encrypted.',
    '28/10/2026, 09:06 - +91 98765 43210: Your KYC is pending',
    'update here https://sbi-kyc-update.com/x',
    '28/10/2026, 21:40 - +91 98765 43210: <Media omitted>',
    '28/10/2026, 12:00 am - X: midnight',
  ].join('\n'));
  assert.equal(m.length, 2, 'system line and media placeholder dropped');
  assert.equal(m[0].sender, '+91 98765 43210');
  assert.equal(m[0].text, 'Your KYC is pending\nupdate here https://sbi-kyc-update.com/x');
  assert.equal(m[1].time, '00:00', '12 am is midnight');
});

test('WhatsApp: iPhone bracketed format with seconds and uppercase PM', () => {
  const [x] = parseWhatsApp('‎[28/10/26, 2:15:30 PM] Agent: send OTP');
  assert.deepEqual([x.date, x.time, x.sender, x.text], ['2026-10-28', '14:15', 'Agent', 'send OTP']);
  assert.deepEqual(parseWhatsApp('31/02/26, 2:15 pm - A: impossible date'), [], 'impossible dates are not headers');
});

test('bank names map to one list, and anything else is not a bank', () => {
  assert.equal(canonicalBank('SBI'), 'State Bank of India');
  assert.equal(canonicalBank('HDFC Bank'), 'HDFC Bank');
  assert.equal(canonicalBank('बँक ऑफ महाराष्ट्र'), 'Bank of Maharashtra');
  assert.equal(canonicalBank('Sunita Deshpande'), '', 'a person\'s name is never taken for a bank');
  assert.equal(canonicalBank(''), '');
});

test('cards: each value with its source line; paid UPI IDs and bank helplines are not scammer cards', () => {
  const sms = 'Rs.1,499.50 debited from a/c **4821 on 28-Oct-26 to VPA refund221@ybl (UPI Ref No 773829104857). Not you? Call 18002586161 -HDFC Bank\n\n'
    + 'ICICI Bank Acct XX4821 debited for Rs 900.00 on 29-Oct-26; RAMESH credited. UPI:430212345678. SMS BLOCK 4821 to 9215676766.';
  const cards = findCards([sms, CHAT], '9123456780');
  const of = (kind) => cards.filter((c) => c.kind === kind).map((c) => c.value);
  assert.deepEqual(of('amount'), ['1,499.50', '900.00']);
  assert.deepEqual(of('utr'), ['773829104857', '430212345678']);
  assert.deepEqual(of('payee'), ['refund221@ybl']);
  assert.deepEqual(of('bank'), ['HDFC Bank', 'ICICI Bank']);
  assert.deepEqual(of('scammer'), ['98765 43210'], 'chat number only: not the paid UPI ID, not 9215676766');
  assert.ok(cards.every((c) => c.state === 'new' && c.source.length <= 162), 'nothing is confirmed until the person taps Correct');
  assert.ok(cards.find((c) => c.kind === 'utr').source.includes('773829104857'));
  assert.equal(new Set(cards.filter((c) => c.group === 0).map((c) => c.kind)).size, 4, 'one payment groups its four fields');
});
