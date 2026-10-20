import test from 'node:test';
import assert from 'node:assert/strict';
import { oaSourceMeasurements, setOaProMapping } from './oaDraftMapping.ts';
import type { OaReportResult } from './oaReportParser.ts';
import type { BodyMetricSources } from '../data/recordStorage.ts';
import { OA_REPORT_INVENTORY } from './oaReportInventory.ts';
import { getBodyMetricSeries } from '../data/bodyMetricComparison.ts';

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

function sourcedDraft() {
 const metricSources: BodyMetricSources = Object.fromEntries(OA_REPORT_INVENTORY
  .filter(([key]) => key !== 'trunkMuscleMass' && key !== 'trunkFatMass')
  .map(([key, originalLabel, originalUnit]) => [key, { device:'OA long report', originalLabel, originalUnit,
   originalText:'synthetic source', method:'ocr', mappingVersion:'oa-pro-v1' }]));
 const patch: Record<string,string> = {...draft().patch,bodyFatPercent:'20',muscleMass:'50',musclePercent:'60',fatMass:'16'};
 return {...draft(),metricSources,patch};
}

test('late confirmation updates every matching photo source and reverses without changing measurements',()=>{
 const original=sourcedDraft(), snapshot=JSON.stringify(original);
 const confirmed=setOaProMapping(original,true);
 assert.equal(Object.keys(confirmed.metricSources).length,30);
 for(const source of Object.values(confirmed.metricSources)) assert.equal(source?.device,'OA Smart Scale PRO');
 for(const [key,value] of Object.entries(original.patch)) assert.equal(confirmed.patch[key],value);
 assert.deepEqual(setOaProMapping(confirmed,false),original);
 assert.deepEqual(setOaProMapping(setOaProMapping(confirmed,false),true),confirmed);
 assert.equal(JSON.stringify(original),snapshot);
});

test('early and late confirmations produce comparable series while an unconfirmed report remains separate',()=>{
 const late=setOaProMapping(sourcedDraft(),true);
 const record={bodyFatPercent:20,muscleMass:50,musclePercent:60,fatMass:16,metricSources:late.metricSources};
 const records={'2025-04-01':record,'2025-04-02':record,'2025-04-03':record};
 for(const key of ['bodyFatPercent','muscleMass','musclePercent','fatMass'] as const) {
  assert.equal(getBodyMetricSeries(records,key).points.length,3);
  assert.equal(getBodyMetricSeries({...records,'2025-04-03':{...record,metricSources:setOaProMapping(late,false).metricSources}},key).points.length,1);
 }
});

test('missing, manual, other-device, wrong-label, wrong-unit and different-version sources are never promoted',()=>{
 const variants=[undefined,{device:'other-device'},{method:'manual'},{originalLabel:'other label'},
  {originalUnit:'%'},{originalUnit:undefined},{mappingVersion:'other-version'}];
 for(const variant of variants) {
  const original=sourcedDraft();
  if(variant===undefined) delete original.metricSources.muscleMass;
  else Object.assign(original.metricSources.muscleMass!,variant);
  original.patch.trunkMuscleMass='19';
  original.metricSources.trunkMuscleMass={...original.metricSources.fatMass!,originalLabel:'different source'};
  const before=JSON.stringify(original);
  for(const checked of [true,false,true]) {
   const mapped=setOaProMapping(original,checked);
   assert.deepEqual(mapped.metricSources.muscleMass,original.metricSources.muscleMass);
   assert.deepEqual(mapped.metricSources.trunkMuscleMass,original.metricSources.trunkMuscleMass);
   assert.equal(mapped.patch.trunkMuscleMass,'19');
  }
  assert.equal(JSON.stringify(original),before);
 }
});

test('edited values and explicit blanks retain their provenance and method across confirmation changes',()=>{
 const original=sourcedDraft();original.patch.muscleMass='';original.metricSources.muscleMass!.method='ocr-edited';
 const confirmed=setOaProMapping(original,true);
 confirmed.patch.trunkMuscleMass='28';confirmed.autoMappedKeys=confirmed.autoMappedKeys.filter(k=>k!=='trunkMuscleMass');
 confirmed.metricSources.trunkMuscleMass!.method='ocr-edited';
 const restored=setOaProMapping(setOaProMapping(confirmed,false),true);
 assert.equal(restored.patch.muscleMass,'');assert.equal(restored.patch.trunkMuscleMass,'28');
 assert.equal(restored.metricSources.muscleMass!.method,'ocr-edited');
 assert.equal(restored.metricSources.trunkMuscleMass!.method,'ocr-edited');
 assert.equal(restored.metricSources.trunkMuscleMass!.device,'OA Smart Scale PRO');
});

test('incompatible reference units remain visible and never become kg mappings',()=>{
 const original=draft();
 Object.assign(original.sourceMeasurements[0],{unit:'%'});
 const confirmed=setOaProMapping(original,true);
 assert.equal(confirmed.patch.trunkMuscleMass,undefined);
 assert.deepEqual(confirmed.unmappedMeasurements,[original.sourceMeasurements[0]]);
});
