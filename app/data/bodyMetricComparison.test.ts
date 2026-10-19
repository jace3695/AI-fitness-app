import test from 'node:test';
import assert from 'node:assert/strict';
import { getBodyMetricSeries, getWholeMuscleTrend } from './bodyMetricComparison.ts';
import { getWeightManagementSummary } from './weightManagement.ts';
import type { InbodyRecordStore, BodyMetricSource } from './recordStorage.ts';

const source: BodyMetricSource = {device:'OA Smart Scale PRO',originalLabel:'체지방률',originalUnit:'%',method:'ocr',mappingVersion:'oa-pro-v1'};
test('OA-only records retain fat/weight analysis without inventing skeletal muscle',()=>{
 const records: InbodyRecordStore = {'2025-04-01':{bodyFatPercent:25,muscleMass:51,fatMass:21,trunkMuscleMass:24},'2025-04-08':{bodyFatPercent:24,muscleMass:50,fatMass:20,trunkMuscleMass:23}};
 const before=JSON.stringify(records);
 const summary=getWeightManagementSummary({'2025-04-01':{weight:78,recordedAt:''},'2025-04-08':{weight:77,recordedAt:''}},records);
 assert.equal(summary.latest?.value,77);assert.equal(summary.bodyFat.change,-1);
 assert.equal(summary.skeletalMuscle.latest,undefined);assert.equal(summary.skeletalMuscle.direction,'unknown');
 assert.equal(summary.assessment.tone,'insufficient');
 assert.equal(getBodyMetricSeries(records,'muscleMass').points.length,2);
 assert.equal(getBodyMetricSeries(records,'skeletalMuscleMass').points.length,0);
 assert.equal(JSON.stringify(records),before);
});
test('older skeletal measurements cannot imply present muscle loss or maintenance',()=>{
 const summary=getWeightManagementSummary({}, {'2025-03-01':{skeletalMuscleMass:31},'2025-03-08':{skeletalMuscleMass:30},'2025-04-01':{bodyFatPercent:25},'2025-04-08':{bodyFatPercent:24}});
 assert.equal(summary.skeletalMuscle.latest,30);
 assert.equal(summary.skeletalMuscle.change,undefined);
 assert.equal(summary.skeletalMuscle.direction,'unknown');
 assert.match(summary.skeletalMuscle.comparisonNote!,/過去|과거/);
 assert.equal(summary.assessment.tone,'insufficient');
});
test('zero, invalid dates and missing observations never create a phantom body change',()=>{
 const records:InbodyRecordStore={'bad':{muscleMass:52},'2025-02-30':{muscleMass:53},'2025-04-01':{muscleMass:51},'2025-04-08':{muscleMass:0},'2025-04-09':{}};
 assert.deepEqual(getBodyMetricSeries(records,'muscleMass').points,[{dateKey:'2025-04-01',value:51}]);
 assert.equal(records['2025-04-08'].muscleMass,0);
});
test('different or unknown sources are not joined to the latest confirmed series',()=>{
 const records:InbodyRecordStore={
  '2025-04-01':{bodyFatPercent:25},
  '2025-04-02':{bodyFatPercent:24,metricSources:{bodyFatPercent:source}},
  '2025-04-03':{bodyFatPercent:23,metricSources:{bodyFatPercent:{...source,method:'ocr-edited'}}},
 };
 const series=getBodyMetricSeries(records,'bodyFatPercent');
 assert.equal(series.points.length,2);assert.equal(series.sourceVerified,true);assert.match(series.note,/이전 기록은 연결하지/);
 records['2025-04-03'].metricSources!.bodyFatPercent={...source,originalUnit:'kg'};
 assert.equal(getBodyMetricSeries(records,'bodyFatPercent').points.length,1);
});

test('verified metrics require matching comparison dates before a combined assessment',()=>{
 const record=(fat:number,muscle:number)=>({bodyFatPercent:fat,skeletalMuscleMass:muscle,metricSources:{bodyFatPercent:source,skeletalMuscleMass:{...source,originalLabel:'skeletal muscle',originalUnit:'kg'}}});
 const aligned:InbodyRecordStore={'2025-04-01':record(25,31),'2025-04-08':record(24,31)};
 assert.equal(getWeightManagementSummary({},aligned).assessment.tone,'positive');
 const mismatched:InbodyRecordStore={...aligned,'2025-04-02':{bodyFatPercent:24.5,metricSources:{bodyFatPercent:source}}};
 assert.equal(getWeightManagementSummary({},mismatched).assessment.tone,'insufficient');
});

const muscleSources = {muscleMass:{...source,originalLabel:'muscle mass',originalUnit:'kg'},musclePercent:{...source,originalLabel:'muscle rate',originalUnit:'%'}};
test('whole muscle estimates remain comparable without skeletal measurements',()=>{
 const records:InbodyRecordStore={'2025-04-01':{muscleMass:50,musclePercent:60,metricSources:muscleSources},'2025-04-08':{muscleMass:51,musclePercent:61,metricSources:muscleSources}};
 const before=JSON.stringify(records);const trend=getWholeMuscleTrend(records);
 assert.equal(trend.kg.direction,'up');assert.equal(trend.kg.delta,1);assert.equal(trend.paired,true);assert.equal(trend.divergent,false);
 assert.match(trend.limitation,/측정 조건 미확인/);assert.equal(JSON.stringify(records),before);
});
test('increasing rate with decreasing kg is explicitly divergent, never muscle gain',()=>{
 const trend=getWholeMuscleTrend({'2025-04-01':{muscleMass:51,musclePercent:60,metricSources:muscleSources},'2025-04-08':{muscleMass:50,musclePercent:61,metricSources:muscleSources}});
 assert.equal(trend.kg.direction,'down');assert.equal(trend.rate.direction,'up');assert.equal(trend.divergent,true);assert.match(trend.explanation,/방향이 다릅니다/);
});
test('single, absent, source changed and unverified data retain values but no paired inference',()=>{
 const one=getWholeMuscleTrend({'2025-04-08':{musclePercent:61,metricSources:muscleSources}});
 assert.equal(one.kg.delta,undefined);assert.equal(one.kg.last,undefined);assert.equal(one.rate.delta,undefined);assert.equal(one.paired,false);
 const changed=getWholeMuscleTrend({'2025-04-01':{muscleMass:50,musclePercent:60,metricSources:muscleSources},'2025-04-08':{muscleMass:51,musclePercent:61}});
 assert.equal(changed.kg.points.length,1);assert.equal(changed.paired,false);
 const unknown=getWholeMuscleTrend({'2025-04-01':{muscleMass:50},'2025-04-08':{muscleMass:51}});
 assert.equal(unknown.kg.delta,1);assert.match(unknown.kg.label,/자료 부족/);assert.equal(unknown.paired,false);
});
test('historical and mismatched periods are identified and cutoff excludes later records',()=>{
 const records:InbodyRecordStore={'2025-04-01':{muscleMass:50,musclePercent:60,metricSources:muscleSources},'2025-04-08':{muscleMass:51,metricSources:muscleSources},'2025-04-09':{musclePercent:61,metricSources:muscleSources}};
 const trend=getWholeMuscleTrend(records);assert.equal(trend.paired,false);assert.equal(trend.historical,true);
 assert.equal(getWholeMuscleTrend(records,'2025-04-08').rate.delta,undefined);
});
test('rounded endpoint direction is descriptive and ignores zero or impossible rate',()=>{
 const trend=getWholeMuscleTrend({'2025-04-01':{muscleMass:50,musclePercent:60,metricSources:muscleSources},'2025-04-08':{muscleMass:50.01,musclePercent:101,metricSources:muscleSources},'2025-04-09':{muscleMass:0}});
 assert.equal(trend.kg.direction,'same');assert.equal(trend.rate.points.length,1);assert.match(trend.criteria,/臨床|임상/);assert.match(trend.limitation,/수분/);
});

test('missing source unit is unverified and cannot join an explicitly sourced series',()=>{
 const records:InbodyRecordStore={'2025-04-01':{muscleMass:50,metricSources:muscleSources},'2025-04-08':{muscleMass:51,metricSources:{muscleMass:{...muscleSources.muscleMass,originalUnit:undefined}}}};
 const result=getWholeMuscleTrend(records);
 assert.equal(result.kg.sourceVerified,false);assert.equal(result.kg.points.length,1);assert.equal(result.kg.delta,undefined);
});
test('empty periods and same-date replacement never fabricate a second observation or missing units',()=>{
 const records:InbodyRecordStore={'2025-04-08':{muscleMass:50,metricSources:muscleSources},'2025-04-09':{fatMass:20}};
 records['2025-04-08']={muscleMass:51,metricSources:muscleSources};
 const result=getWholeMuscleTrend(records);
 assert.equal(result.kg.points.length,1);assert.equal(result.kg.last?.value,51);assert.equal(result.kg.delta,undefined);assert.equal(result.rate.last,undefined);assert.equal(result.rate.delta,undefined);
 assert.equal(getWholeMuscleTrend(records,'2025-04-01').kg.points.length,0);
 assert.equal(getWholeMuscleTrend({}).kg.last,undefined);
});
test('incompatible kg/percent provenance is excluded without rewriting stored values',()=>{
 const records:InbodyRecordStore={'2025-04-08':{muscleMass:50,musclePercent:60,metricSources:{muscleMass:{...muscleSources.muscleMass,originalUnit:'%'},musclePercent:{...muscleSources.musclePercent,originalUnit:'kg'}}}};
 const before=JSON.stringify(records);const result=getWholeMuscleTrend(records);
 assert.equal(result.kg.last,undefined);assert.equal(result.rate.last,undefined);assert.equal(result.paired,false);assert.equal(JSON.stringify(records),before);
});

test('an incompatible unit between matching sources breaks the comparison series',()=>{
 const records:InbodyRecordStore={
  '2025-04-01':{muscleMass:50,metricSources:muscleSources},
  '2025-04-02':{muscleMass:60,metricSources:{muscleMass:{...muscleSources.muscleMass,originalUnit:'%'}}},
  '2025-04-03':{muscleMass:51,metricSources:muscleSources},
 };
 const before=JSON.stringify(records);
 const trend=getWholeMuscleTrend(records);
 assert.deepEqual(trend.kg.points,[{dateKey:'2025-04-03',value:51}]);
 assert.equal(trend.kg.delta,undefined);
 assert.equal(JSON.stringify(records),before);
});

test('a different device between matching sources also breaks the comparison series',()=>{
 const records:InbodyRecordStore={
  '2025-04-01':{muscleMass:50,metricSources:muscleSources},
  '2025-04-02':{muscleMass:51,metricSources:{muscleMass:{...muscleSources.muscleMass,device:'OA long report'}}},
  '2025-04-03':{muscleMass:52,metricSources:muscleSources},
  '2025-04-04':{},
  '2025-04-05':{muscleMass:53,metricSources:muscleSources},
 };
 const trend=getWholeMuscleTrend(records);
 assert.deepEqual(trend.kg.points,[{dateKey:'2025-04-03',value:52},{dateKey:'2025-04-05',value:53}]);
 assert.equal(trend.kg.delta,1);
});
