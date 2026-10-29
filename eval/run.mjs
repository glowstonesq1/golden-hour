// Scores the Check rules on every test set that is present and writes eval/results.md.
// Usage: node eval/run.mjs [--split dev|test]   (default test; dev is for tuning, test is what we publish)
// Sets: data/synthetic/<split>.jsonl always; data/advisory/advisory.jsonl and
// data/public/SMSSpamCollection when they exist (both are collected on a machine that can reach the sources).
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { check } from '../static/rules.js';

export const TYPE_KEYS = ['kyc', 'arrest', 'parcel', 'bill', 'job', 'invest', 'loan', 'prize', 'otp', 'family', 'threat'];

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

export function score(rows) {
  const scams = rows.filter((r) => r.label === 'scam');
  const genuine = rows.filter((r) => r.label === 'genuine');
  const results = rows.map((r) => ({ ...r, out: check(r.text) }));
  const res = (label) => results.filter((r) => r.label === label);

  const flagged = res('scam').filter((r) => r.out.verdict !== 'none');
  const perType = TYPE_KEYS.map((t) => {
    const gold = res('scam').filter((r) => r.type === t);
    const predicted = results.filter((r) => r.out.verdict !== 'none' && r.out.type === t);
    const correct = predicted.filter((r) => r.label === 'scam' && r.type === t);
    return { type: t, n: gold.length, precision: [correct.length, predicted.length], recall: [correct.length, gold.length] };
  });
  return {
    n: rows.length,
    templates: new Set(rows.map((r) => r.template ?? r.id)).size,
    scam: {
      n: scams.length,
      likely: res('scam').filter((r) => r.out.verdict === 'likely').length,
      flagged: flagged.length,
      typeCorrect: flagged.filter((r) => r.type && r.out.type === r.type).length,
      typed: flagged.filter((r) => r.type).length,
    },
    genuine: {
      n: genuine.length,
      falseAlarm: res('genuine').filter((r) => r.out.verdict === 'likely').length,
      careful: res('genuine').filter((r) => r.out.verdict === 'careful').length,
    },
    perType,
    misses: res('scam').filter((r) => r.out.verdict === 'none').map((r) => r.id),
    alarms: res('genuine').filter((r) => r.out.verdict !== 'none').map((r) => `${r.id} (${r.out.verdict}: ${r.out.signs.join(', ') || r.out.type})`),
    wrongType: flagged.filter((r) => r.type && r.out.type !== r.type).map((r) => `${r.id} -> ${r.out.type}`),
  };
}

const readJsonl = async (url) =>
  (await readFile(url, 'utf8')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

async function loadOptional(url, parse) {
  try {
    return parse(await readFile(url, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// UCI SMS Spam Collection: "ham<TAB>text" or "spam<TAB>text". Its spam is mostly promotions, not fraud,
// so only the ham half is scored (as real genuine messages, for false alarms).
export const parseUci = (raw) =>
  raw.split('\n').filter((l) => l.startsWith('ham\t')).map((l, i) => ({ id: `uci-ham-${i + 1}`, label: 'genuine', type: null, text: l.slice(4) }));

export function validateAdvisory(rows) {
  for (const r of rows) {
    if (!/^https:\/\//.test(r.source_url || '')) throw new Error(`advisory row ${r.id} has no https source_url`);
    if (r.label !== 'scam' || !TYPE_KEYS.includes(r.type)) throw new Error(`advisory row ${r.id} needs label "scam" and a known type`);
  }
  return rows;
}

function section(title, s, note) {
  const lines = [`## ${title}`, '', note, '', `${s.n} messages from ${s.templates} templates or sources.`, ''];
  if (s.scam.n) {
    lines.push(
      '| Scam messages | Value |', '| --- | --- |',
      `| Flagged (likely scam or be careful) | ${pct(s.scam.flagged, s.scam.n)} (${s.scam.flagged}/${s.scam.n}) |`,
      `| Called likely scam | ${pct(s.scam.likely, s.scam.n)} (${s.scam.likely}/${s.scam.n}) |`,
      `| Right scam type, when flagged | ${pct(s.scam.typeCorrect, s.scam.typed)} (${s.scam.typeCorrect}/${s.scam.typed}) |`, '',
      '| Type | Messages | Precision | Recall |', '| --- | --- | --- | --- |',
      ...s.perType.filter((t) => t.n || t.precision[1]).map((t) =>
        `| ${t.type} | ${t.n} | ${pct(...t.precision)} (${t.precision.join('/')}) | ${pct(...t.recall)} (${t.recall.join('/')}) |`),
      '',
    );
  }
  if (s.genuine.n) {
    lines.push(
      '| Genuine messages | Value |', '| --- | --- |',
      `| False alarm (called likely scam) | ${pct(s.genuine.falseAlarm, s.genuine.n)} (${s.genuine.falseAlarm}/${s.genuine.n}) |`,
      `| Called be careful | ${pct(s.genuine.careful, s.genuine.n)} (${s.genuine.careful}/${s.genuine.n}) |`, '',
    );
  }
  const list = (name, xs) => (xs.length ? [`${name}: ${xs.join('; ')}`, ''] : []);
  lines.push(...list('Missed scams', s.misses), ...list('Genuine messages flagged', s.alarms), ...list('Wrong type', s.wrongType));
  return lines.join('\n');
}

export async function run(split = 'test') {
  const sets = [];
  const synthetic = await readJsonl(new URL(`../data/synthetic/${split}.jsonl`, import.meta.url));
  sets.push([`Synthetic ${split} set`, score(synthetic),
    'Hand-written templates filled with fake values. Written by the same person who wrote the rules, so treat these numbers as an upper bound.']);
  const advisory = await loadOptional(new URL('../data/advisory/advisory.jsonl', import.meta.url),
    (raw) => validateAdvisory(raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))));
  if (advisory?.length) sets.push(['Advisory set', score(advisory), 'Real scam texts quoted in official advisories, labelled by hand. The most realistic test.']);
  const uci = await loadOptional(new URL('../data/public/SMSSpamCollection', import.meta.url), parseUci);
  if (uci?.length) sets.push(['UCI SMS Spam Collection, genuine half', score(uci), 'Real English messages from 2011 (UK and Singapore). Measures false alarms only.']);

  const started = performance.now();
  for (const r of synthetic) check(r.text);
  const msPerCheck = (performance.now() - started) / synthetic.length;

  const missing = [!advisory?.length && 'advisory set (data/advisory/advisory.jsonl is empty)', !uci?.length && 'UCI public set (data/public/SMSSpamCollection not downloaded)'].filter(Boolean);
  const md = [
    '# Check v1 evaluation (rule layer)',
    '',
    'Generated by `node eval/run.mjs`. Do not edit by hand.',
    '',
    'These numbers come from synthetic and public data. They have not been checked on real users\' messages.',
    ...(missing.length ? ['', `Not scored yet: ${missing.join('; ')}.`] : []),
    '',
    ...sets.map(([title, s, note]) => section(title, s, note)),
    `Speed: ${msPerCheck.toFixed(3)} ms per check in Node on a desktop CPU. Not yet measured on a low-end Android phone.`,
    '',
  ].join('\n');
  return { md, sets };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const split = process.argv.includes('--split') ? process.argv[process.argv.indexOf('--split') + 1] : 'test';
  const { md } = await run(split);
  if (split === 'test') await writeFile(new URL('./results.md', import.meta.url), md);
  console.log(md);
}
