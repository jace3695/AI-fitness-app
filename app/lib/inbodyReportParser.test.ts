import test from 'node:test';
import assert from 'node:assert/strict';
import { agreedInbody270sReport, readInbody270sLines, inbodyLayoutLines, type InbodyLayoutLine, INBODY_270S_INVENTORY } from './inbodyReportParser.ts';
import { mapOaMeasurements } from './oaReportParser.ts';
import { mergeBodyImport } from './bodyImport.ts';

// Entirely invented measurements. Only generic manufacturer labels are reused.
const texts = [
  '[InBody270S]', 'Body Composition Analysis',
  'For storing excess energy Body Fat Mass (kg) 17.4 (10.0 ~ 20.0)',
  'Sum of the above Weight (kg) 79.6 (60.0 ~ 90.0)',
  'Muscle-Fat Analysis', 'SMM Skeletal Muscle Mass (kg) 32.8',
  'Obesity Analysis', 'BMI Body Mass Index (kg/m²) 25.7', 'PBF Percent Body Fat (%) 21.9',
  'Research Parameters', 'Fat Free Mass 62.2 kg (50.0 ~ 75.0)', 'Basal Metabolic Rate 1623 kcal (1400 ~ 1800)',
];
const lines = (items = texts) => items.map(text => ({ text, confidence: 94 }));
const report = (items = texts) => agreedInbody270sReport([lines(items), lines(items)]);

test('new labeled InBody format maps seven separate metrics; OA never pretended to support these clinical rows', () => {
  const result = report();
  assert.deepEqual(result.values, { weight: 79.6, skeletalMuscleMass: 32.8, bodyFatMass: 17.4, bodyFatPercent: 21.9, bmi: 25.7, fatFreeMass: 62.2, basalMetabolicRate: 1623 });
  assert.equal(result.recognizedCount, 7); assert.deepEqual(result.reviewKeys, []);
  assert.deepEqual(mapOaMeasurements({ skeletalMuscleMass: 32.8, bodyFatMass: 17.4 }).values, {});
  assert.ok(!Object.hasOwn(result.values, 'muscleMass'));
  assert.equal(result.detectedDate, undefined, 'source dates require manual review, never today or a history date');
  assert.equal(INBODY_270S_INVENTORY.length, 7);
});

test('different models, missing model and low-confidence model never acquire InBody provenance', () => {
  for (const model of ['InBody', '[InBody770]', 'InBody 270', '건강 보고서', '']) {
    const result = report([model, ...texts.slice(1)]);
    assert.deepEqual(result.values, {}, model); assert.deepEqual(result.metricSources, {});
    assert.match(result.warnings![0], /양식을 확인하지 못/);
  }
  const low = lines(); low[0].confidence = 59;
  assert.deepEqual(agreedInbody270sReport([low, lines()]).values, {});
});

test('at least two complete observations must independently agree; a third conflicting read prevents acceptance', () => {
  assert.deepEqual(agreedInbody270sReport([lines()]).values, {});
  const changed = lines(texts.map(text => text.replace('79.6', '79.8')));
  const result = agreedInbody270sReport([lines(), changed]);
  assert.equal(result.values.weight, undefined); assert.equal(result.values.bodyFatMass, 17.4);
  assert.equal(agreedInbody270sReport([lines(), lines(), changed]).values.weight, undefined);
});

test('unknown units, missing decimals, labels, conflicting rows and graph tick runs stay blank', () => {
  for (const tail of ['(lb) 79.6', '(g) 79.6', '(kg) 796', '79.6', '(kg) 79.O', '(kg) 79.6 60 70 80', '(kg) 79.6 (60.0 ~ 90.0) lb', '(kg) 79.6 / 175', '(kg) -79.6', '(kg) 79,6']) {
    const result = report(texts.map(text => text.startsWith('Sum of') ? `Weight ${tail}` : text));
    assert.equal(result.values.weight, undefined, tail);
  }
  for (const duplicate of ['Weight (kg) 79.8', 'Weight (kg) 79.6', 'Weight (lb) 79.6']) {
    const result = report([...texts.slice(0, 4), duplicate, ...texts.slice(4)]);
    assert.equal(result.values.weight, undefined, duplicate);
  }
});

test('reference ranges are not values, target/history/segmental sections cannot supply current measurements', () => {
  const empty = ['[InBody270S]', 'Body Composition Analysis', 'Weight (kg) (60.0 ~ 90.0)',
    'Weight Control', 'Target Weight 65.0 kg', 'Weight (kg) 65.0',
    'Body Composition History', 'Weight (kg) 79.6', 'Skeletal Muscle Mass (kg) 32.8',
    'Segmental Lean Analysis', 'Skeletal Muscle Mass (kg) 32.8', 'Fat Free Mass 62.2 kg'];
  assert.deepEqual(report(empty).values, {});
  assert.deepEqual(report(['[InBody270S]', 'Weight (kg) 79.6']).values, {});
});

test('generic muscle, segmental lean mass, abbreviation-only and translated labels are not skeletal muscle', () => {
  for (const label of ['Muscle Mass', 'Lean Mass', 'Segmental Lean Mass', 'SMM', '근육량', '골격근량']) {
    const result = report(texts.map(text => text.startsWith('SMM ') ? `${label} (kg) 32.8` : text));
    assert.equal(result.values.skeletalMuscleMass, undefined, label);
    assert.equal(result.values.muscleMass, undefined, label);
  }
});

test('low confidence, unknown headings and out of range values require manual review', () => {
  const low = lines(); low[3].confidence = 59;
  assert.equal(agreedInbody270sReport([low, lines()]).values.weight, undefined);
  const lowHeader = lines(); lowHeader[1].confidence = 59;
  assert.equal(agreedInbody270sReport([lowHeader, lines()]).values.weight, undefined);
  assert.equal(report(texts.map(text => text.replace('Body Composition Analysis', 'Unknown Summary'))).values.weight, undefined);
  for (const number of ['0.0', '999.0']) assert.equal(report(texts.map(text => text.replace('79.6', number))).values.weight, undefined);
});

test('each saved field retains exact source text and unit; edited values mark original evidence edited', () => {
  const result = report(); const day = '2025-04-07';
  const weights = { [day]: { weight: 80.2, recordedAt: 'before' } };
  const old = { [day]: { muscleMass: 58.1, trunkMuscleMass: 24.3, memo: 'synthetic keep', bodyAge: 41 } };
  const patch = Object.fromEntries(Object.entries(result.values).map(([key, value]) => [key, String(value)]));
  const saved = mergeBodyImport(weights, old, day, patch, '2026-10-28', result.metricSources);
  const reloaded = JSON.parse(JSON.stringify(saved));
  assert.equal(reloaded.inbody[day].skeletalMuscleMass, 32.8);
  assert.equal(reloaded.inbody[day].muscleMass, 58.1); assert.equal(reloaded.inbody[day].trunkMuscleMass, 24.3);
  assert.equal(reloaded.inbody[day].memo, 'synthetic keep'); assert.equal(reloaded.inbody[day].bodyAge, 41);
  assert.equal(reloaded.inbody[day].metricSources.bodyFatMass.originalText, texts[2]);
  assert.equal(reloaded.inbody[day].metricSources.bodyFatMass.device, 'InBody 270S English report');
  const corrected = mergeBodyImport(saved.weights, saved.inbody, day, { bodyFatMass: '17.6' }, '2026-10-28');
  assert.equal(corrected.inbody[day].metricSources?.bodyFatMass?.method, 'ocr-edited');
  assert.equal(corrected.inbody[day].metricSources?.bodyFatMass?.originalText, texts[2]);
  assert.deepEqual(old[day], { muscleMass: 58.1, trunkMuscleMass: 24.3, memo: 'synthetic keep', bodyAge: 41 });
});

test('read adapter never mutates its OCR input or retains account/header identity', () => {
  const input = lines(['[InBody270S]', 'ID synthetic-private-field', ...texts.slice(1)]);
  const before = structuredClone(input); const result = readInbody270sLines(input);
  assert.deepEqual(input, before);
  assert.ok(!JSON.stringify(result).includes('synthetic-private-field'));
});


function layoutLine(text: string, x: number, y: number): InbodyLayoutLine {
  const bbox = { x0: x, x1: x + text.length * 8, y0: y, y1: y + 18 };
  return { text, confidence: 95, bbox, words: [{ text, confidence: 95, bbox }] };
}

test('separate OCR table blocks rejoin by visible row geometry, not by text extraction order', () => {
  const input = [layoutLine('[InBody270S]', 300, 20), layoutLine('Body Composition Analysis', 20, 100),
    layoutLine('Weight', 100, 150), layoutLine('(kg)', 300, 150), layoutLine('79.6', 380, 150),
    layoutLine('Muscle-Fat Analysis', 20, 250), layoutLine('Research Parameters', 700, 300),
    layoutLine('(60.0 ~ 90.0)', 470, 150)];
  const before = structuredClone(input); const normalized = inbodyLayoutLines(input);
  assert.equal(agreedInbody270sReport([normalized, normalized]).values.weight, 79.6);
  assert.deepEqual(input, before);
  const wrongUnit = inbodyLayoutLines(input.map(line => line.text === '(kg)' ? layoutLine('(lb)', 300, 150) : line));
  assert.equal(agreedInbody270sReport([normalized, wrongUnit]).values.weight, undefined);
});

test('table geometry does not borrow a nearby number, omit an unknown unit, or accept uncertain heading positions', () => {
  const headings = [layoutLine('[InBody270S]', 300, 20), layoutLine('Body Composition Analysis', 20, 100),
    layoutLine('Muscle-Fat Analysis', 20, 250), layoutLine('Research Parameters', 700, 300)];
  for (const fragments of [
    [layoutLine('Weight (kg)', 100, 150), layoutLine('79.6', 380, 180)],
    [layoutLine('Weight (kg) 79.6', 100, 150), layoutLine('lb', 450, 150)],
    [layoutLine('Weight (kg) 79.6', 100, 270)],
  ]) {
    const normalized = inbodyLayoutLines([...headings.slice(0, 2), ...fragments, ...headings.slice(2)]);
    assert.equal(agreedInbody270sReport([normalized, normalized]).values.weight, undefined);
  }
  const ambiguous = [...headings, layoutLine('Body Composition Analysis', 20, 400)];
  assert.deepEqual(inbodyLayoutLines(ambiguous), []);
});


test('unknown headings and numeric chart ticks close the previous section before a plausible labeled value', () => {
  for (const boundary of ['Unknown Summary', 'Unexpected Control', '70 80 90 100', '2025-04-07', 'Total Body Water (lb) 45.0']) {
    assert.deepEqual(report(['[InBody270S]', 'Body Composition Analysis', boundary, 'Weight (kg) 79.6']).values, {}, boundary);
  }
  const result = report(['[InBody270S]', 'Body Composition Analysis', 'Unknown Summary', 'Weight (kg) 79.6',
    'Research Parameters', 'Basal Metabolic Rate 1623 kcal']);
  assert.deepEqual(result.values, { basalMetabolicRate: 1623 });
});

test('only complete known non-stored composition rows can precede supported current table values', () => {
  const result = report(['[InBody270S]', 'Body Composition Analysis',
    'Total amount of water in body Total Body Water (L) 45.0 (40.0 ~ 50.0)',
    'For building muscles Protein (kg) 12.3 (10.0 ~ 15.0)',
    'For strengthening bones Minerals (kg) 3.4 (2.5 ~ 4.0)', 'Weight (kg) 79.6']);
  assert.deepEqual(result.values, { weight: 79.6 });
  assert.ok(!Object.hasOwn(result.values, 'proteinPercent'));
});


test('small OCR left-edge differences keep research rows after their own heading, not inside the left column', () => {
  const input = [layoutLine('[InBody270S]', 300, 20), layoutLine('Body Composition Analysis', 20, 100),
    layoutLine('Weight (kg) 79.6', 100, 150), layoutLine('Muscle-Fat Analysis', 20, 250),
    layoutLine('Research Parameters', 702, 300), layoutLine('Fat Free Mass 62.2 kg', 700, 340),
    layoutLine('Basal Metabolic Rate 1623 kcal', 703, 380)];
  const normalized = inbodyLayoutLines(input);
  assert.deepEqual(agreedInbody270sReport([normalized, normalized]).values, {weight:79.6,fatFreeMass:62.2,basalMetabolicRate:1623});
});
