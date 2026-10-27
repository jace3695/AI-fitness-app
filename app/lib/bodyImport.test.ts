import test from 'node:test';
import assert from 'node:assert/strict';
import { validMeasurementDate, mergeBodyImport, bodyForm, bodyImportOwner } from './bodyImport.ts';

test('measurement dates reject rollover, malformed and future values', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-15', '', '2026-1-02']) assert.equal(validMeasurementDate(date, '2026-10-14'), false, date);
  assert.equal(validMeasurementDate('2024-02-29', '2026-10-14'), true);
});
test('import saves the measurement day only, preserving unknown fields and memo', () => {
  const weights = { '2026-10-14': { weight: 81, recordedAt: 'original' }, '2026-10-01': { weight: 80, recordedAt: 'old' } };
  const inbody = { '2026-10-01': { bmi: 24, bodyAge: 40, memo: 'keep' } };
  const next = mergeBodyImport(weights, inbody, '2026-10-01', { weight: '79.2', bmi: '23' }, '2026-10-14');
  assert.equal(next.weights['2026-10-01'].weight, 79.2);
  assert.deepEqual(next.weights['2026-10-14'], weights['2026-10-14']);
  assert.deepEqual(next.inbody['2026-10-01'], { bmi: 23, bodyAge: 40, memo: 'keep' });
  assert.equal(weights['2026-10-01'].weight, 80);
  assert.equal(bodyForm(next.weights, next.inbody, '2026-10-01').memo, 'keep');
});
test('new measurement date does not copy fields from another day; explicit edits win', () => {
  const next = mergeBodyImport({}, { '2026-10-01': { memo: 'old', bodyAge: 40 } }, '2026-10-02', { bmi: '21', memo: 'edited' }, '2026-10-14');
  assert.deepEqual(next.inbody['2026-10-02'], { bmi: 21, memo: 'edited' });
  assert.throws(() => mergeBodyImport({}, {}, '2026-02-30', { weight: '80' }, '2026-10-14'));
  assert.throws(() => mergeBodyImport({}, {}, '2026-10-02', { weight: 'Infinity' }, '2026-10-14'));
});
test('session epoch invalidates even a same-account re-login', () => {
  const values = new Map([['fitness-cloud-sync-user', 'A'], ['fitness-cloud-sync-epoch', '1']]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  const before = bodyImportOwner(storage);
  values.set('fitness-cloud-sync-epoch', '2');
  assert.notEqual(bodyImportOwner(storage), before);
  values.set('fitness-cloud-sync-user', 'B');
  assert.notEqual(bodyImportOwner(storage), before);
});

test('rounded import weight must remain positive and finite without mutating existing records', () => {
  const weights = { '2026-10-01': { weight: 80, recordedAt: 'original' } };
  for (const weight of ['0.01', '0.04', '1e308']) {
    assert.throws(() => mergeBodyImport(weights, {}, '2026-10-01', { weight }, '2026-10-14'));
    assert.equal(weights['2026-10-01'].weight, 80);
  }
  assert.equal(mergeBodyImport(weights, {}, '2026-10-01', { weight: '80.16' }, '2026-10-14').weights['2026-10-01'].weight, 80.2);
});

const sourceDate = '2026-10-01';
const originalWeightSource = { device: 'OA long report' as const, originalLabel: '체중', originalUnit: 'kg', originalText: '80.2kg', method: 'ocr' as const, mappingVersion: 'oa-pro-v1' as const };
const originalWeights = { [sourceDate]: { weight: 80.2, recordedAt: 'original' } };
const originalInbody = { [sourceDate]: { bmi: 24.1, memo: 'synthetic preserved', metricSources: { weight: originalWeightSource } } };

test('an explicit correction to an unrecognized imported weight marks its retained source edited', () => {
  const before = structuredClone({ weights: originalWeights, inbody: originalInbody });
  const next = mergeBodyImport(originalWeights, originalInbody, sourceDate, { weight: '82.4', bmi: '24.8' }, '2026-10-27');
  assert.equal(next.weights[sourceDate].weight, 82.4);
  assert.deepEqual(next.inbody[sourceDate].metricSources?.weight, { ...originalWeightSource, method: 'ocr-edited' });
  assert.equal(next.inbody[sourceDate].bmi, 24.8);
  assert.equal(next.inbody[sourceDate].memo, 'synthetic preserved');
  assert.deepEqual({ weights: originalWeights, inbody: originalInbody }, before);
});

test('omitted, unchanged and rounded-equivalent weight patches retain their source unchanged', () => {
  const patches: Record<string, string>[] = [{ bmi: '24.8' }, { weight: '80.2' }, { weight: '80.24' }];
  for (const patch of patches) {
    const next = mergeBodyImport(originalWeights, originalInbody, sourceDate, patch, '2026-10-27');
    assert.equal(next.weights[sourceDate].weight, 80.2);
    assert.deepEqual(next.inbody[sourceDate].metricSources?.weight, originalWeightSource);
  }
});

test('a fresh OCR source is retained, absent provenance is not invented and clearing removes it', () => {
  const fresh = { ...originalWeightSource, originalText: '82.4kg' };
  const replaced = mergeBodyImport(originalWeights, originalInbody, sourceDate, { weight: '82.4' }, '2026-10-27', { weight: fresh });
  assert.deepEqual(replaced.inbody[sourceDate].metricSources?.weight, fresh);
  const manual = mergeBodyImport(originalWeights, { [sourceDate]: { memo: 'synthetic' } }, sourceDate, { weight: '82.4' }, '2026-10-27');
  assert.equal(manual.inbody[sourceDate].metricSources, undefined);
  const cleared = mergeBodyImport(originalWeights, originalInbody, sourceDate, { weight: '' }, '2026-10-27');
  assert.equal(cleared.weights[sourceDate], undefined);
  assert.equal(cleared.inbody[sourceDate].metricSources, undefined);
  assert.equal(cleared.inbody[sourceDate].memo, 'synthetic preserved');
});
