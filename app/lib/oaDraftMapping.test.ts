import test from 'node:test';
import assert from 'node:assert/strict';
import { oaSourceMeasurements, setOaProMapping } from './oaDraftMapping.ts';
import type { OaReportResult } from './oaReportParser.ts';

const result: OaReportResult = { values: {weight:78}, recognizedCount:3, unmappedMeasurements:[
  {source:'OA',label:'신체 근육량',value:27.4,unit:'kg'},
  {source:'OA',label:'체지방량',value:11.8,unit:'kg'},
] };
const draft = () => ({ date:'2025-04-07', owner:'fixture', patch:{weight:'78'} as Record<string,string>, metricSources:{},
  sourceMeasurements:oaSourceMeasurements(result), unmappedMeasurements:result.unmappedMeasurements!,autoMappedKeys:[] as string[] });

test('late PRO confirmation maps existing reference reads and reverses only automatic mappings',()=>{
 const original=draft(), mapped=setOaProMapping(original,true);
 assert.equal(mapped.patch.trunkMuscleMass,'27.4'); assert.equal(mapped.patch.trunkFatMass,'11.8');
 assert.equal(mapped.unmappedMeasurements.length,0);assert.equal(mapped.autoMappedKeys.length,2);
 assert.equal(mapped.date,original.date);assert.equal(mapped.owner,original.owner);
 assert.deepEqual(setOaProMapping(mapped,false),original);
 assert.deepEqual(original.patch,{weight:'78'});
});

test('manual edits, explicit blanks and pre-existing draft values survive repeated toggles',()=>{
 for(const value of ['28.2','', '27.4']) {
  const original=draft();original.patch.trunkMuscleMass=value;
  const mapped=setOaProMapping(original,true), reverted=setOaProMapping(mapped,false);
  assert.equal(mapped.patch.trunkMuscleMass,value);assert.equal(reverted.patch.trunkMuscleMass,value);
  assert.equal(setOaProMapping(reverted,true).patch.trunkMuscleMass,value);
 }
 const mapped=setOaProMapping(draft(),true);
 mapped.patch.trunkMuscleMass='28.2';mapped.autoMappedKeys=mapped.autoMappedKeys.filter(key=>key!=='trunkMuscleMass');
 assert.equal(setOaProMapping(mapped,false).patch.trunkMuscleMass,'28.2');
 assert.equal(setOaProMapping(mapped,false).patch.trunkFatMass,undefined);
});

test('a report initially confirmed retains reference readings for later reversal',()=>{
 const sourceMeasurements=oaSourceMeasurements({values:{trunkMuscleMass:27.4},recognizedCount:1,
  metricSources:{trunkMuscleMass:{device:'OA Smart Scale PRO',originalLabel:'신체 근육량',method:'ocr',mappingVersion:'oa-pro-v1'}}});
 assert.deepEqual(sourceMeasurements,[result.unmappedMeasurements![0]]);
});
