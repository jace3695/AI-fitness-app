import test from 'node:test';
import assert from 'node:assert/strict';
import type { InbodyRecord } from '../data/recordStorage';
import { correctOaSourceDevice, oaCorrectionKeys, OA_CORRECTION_FIELDS } from './oaSourceCorrection.ts';

function fixture(): InbodyRecord {
  return { bodyFatPercent:20, muscleMass:50, musclePercent:60, fatMass:16, memo:'synthetic memo', trunkMuscleMass:25,
    metricSources:Object.fromEntries(OA_CORRECTION_FIELDS.map(([key,originalLabel,originalUnit]) => [key,
      {device:'OA long report',originalLabel,originalUnit,method:'ocr-edited',mappingVersion:'oa-pro-v1',originalText:'synthetic'}])) };
}
test('explicit correction changes only four eligible device fields without mutating the original', () => {
  const original=fixture(), snapshot=JSON.stringify(original), corrected=correctOaSourceDevice(original);
  assert.equal(oaCorrectionKeys(original).length,4);
  assert.equal(oaCorrectionKeys(corrected).length,0);
  for(const [key] of OA_CORRECTION_FIELDS) {
    assert.equal(corrected.metricSources![key]!.device,'OA Smart Scale PRO');
    corrected.metricSources![key]={...corrected.metricSources![key]!,device:'OA long report'};
  }
  assert.deepEqual(corrected,original); assert.equal(JSON.stringify(original),snapshot);
});
test('unknown provenance, units, devices and invalid values are never promoted', () => {
  for(const variant of [undefined,{device:'other'},{originalLabel:'skeletal'},{originalUnit:'%'},
    {originalUnit:undefined},{mappingVersion:undefined},{mappingVersion:'other'},{method:'manual'}]) {
    const record=fixture();
    if(variant===undefined) delete record.metricSources!.muscleMass;
    else Object.assign(record.metricSources!.muscleMass!,variant);
    assert.ok(!oaCorrectionKeys(record).includes('muscleMass'));
    assert.deepEqual(correctOaSourceDevice(record).metricSources!.muscleMass,record.metricSources!.muscleMass);
  }
  for(const value of [0,-1,NaN,Infinity,101]) {
    const record=fixture(); record.bodyFatPercent=value;
    assert.ok(!oaCorrectionKeys(record).includes('bodyFatPercent'));
  }
});
