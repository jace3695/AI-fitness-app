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
