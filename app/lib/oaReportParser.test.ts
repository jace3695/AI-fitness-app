import assert from "node:assert/strict";
import test from "node:test";
import { numberFromText, dateFromText, agreedNumber, recoveredNumber, agreedTimestamp } from "./oaReportParser.ts";

test('smaller crop retries recover only independently agreed non-conflicting readings', () => {
  const row = { key: 'bmi' as const, centerY: 0, min: 5, max: 80, decimals: true };
  const read = (text: string, confidence = 94) => ({ text, confidence });
  const retries = [read('24.7'), read('24.7')];
  assert.equal(recoveredNumber([read('24:7'), read('24.7')], retries, row), 24.7);
  assert.equal(recoveredNumber([read('24.7', 42), read('24.7', 55)], retries, row), 24.7);
  assert.equal(recoveredNumber([read('24.76'), read('24.7')], retries, row), undefined);
  assert.equal(recoveredNumber([read('24.1', 12), read('24.7')], retries, row), undefined);
  assert.equal(recoveredNumber([], [read('24.7')], row), undefined);
  assert.equal(recoveredNumber([], [read('24.7'), read('24.7', 59)], row), undefined);
  assert.equal(recoveredNumber([], [read('24.7'), read('24.1')], row), undefined);
  assert.equal(recoveredNumber([], [read('247'), read('247')], row), undefined);
  assert.equal(recoveredNumber([], [read('24:7'), read('24:7')], row), undefined);
});

test('timestamp retries require two complete clocks agreeing with the detected date', () => {
  const date = '2025-03-11';
  const read = (text: string, confidence = 94) => ({ text, confidence });
  const valid = read(`${date} 07:16:25`);
  assert.equal(agreedTimestamp([valid, valid], date), '07:16:25');
  for (const other of [read(`${date} 7:16:25`), read(`${date} 16:25`), read(`${date} 07:16:26`), read('2025-03-12 07:16:25'), read(`${date} 24:16:25`), read(`${date} 07:16:25`, 59)]) {
    assert.equal(agreedTimestamp([valid, other], date), undefined);
  }
  assert.equal(agreedTimestamp([valid], date), undefined);
  assert.equal(agreedTimestamp([valid, valid]), undefined);
});

test("오아 OCR의 유사 문자를 숫자로 추정하지 않는다", () => {
  assert.equal(
    numberFromText("83,O kg", {
      key: "weight",
      centerY: 0,
      min: 20,
      max: 300,
      decimals: true,
    }),
    undefined,
  );
});

test("소수점이 누락된 체지방률을 후보에서 제외한다", () => {
  assert.equal(
    numberFromText("299", {
      key: "bodyFatPercent",
      centerY: 0,
      min: 1,
      max: 80,
      decimals: true,
    }),
    undefined,
  );
});

test('empty labels, categories, ranges and uncertain decimals remain unfilled', () => {
  const row = { key: 'bodyScore' as const, centerY: 0, min: 1, max: 100 };
  for (const text of ['', ' ', 'O', '7O', '1O points', 'points', 'A+ points', '0', '76 100', '70-80']) assert.equal(numberFromText(text, row), undefined);
  const bmi = { ...row, key: 'bmi' as const, min: 5, max: 80, decimals: true };
  assert.equal(numberFromText('26 . 4', bmi), 26.4);
  assert.equal(numberFromText('26', bmi), undefined);
  assert.equal(numberFromText('264', bmi), undefined);
  assert.equal(numberFromText('30', { ...row, key: 'bodyAge', min: 10, max: 120 }), undefined);
  assert.equal(agreedNumber([{text:'26.4',confidence:95},{text:'26',confidence:95}], bmi), undefined);
  assert.equal(agreedNumber([{text:'26.4',confidence:40},{text:'26.4',confidence:95}], bmi), undefined);
  assert.equal(agreedNumber([{text:'26.4',confidence:95},{text:'26.4',confidence:95}], bmi), 26.4);
});

test('explicit OCR units must belong to the source row, even when both reads agree', () => {
  const cases = [
    { key: 'weight', text: '82.4 %', min: 20, max: 300, decimals: true },
    { key: 'bodyFatPercent', text: '24.7 kg', min: 1, max: 80, decimals: true },
    { key: 'basalMetabolicRate', text: '1800 kg', min: 500, max: 5000 },
    { key: 'boneMass', text: '3.2 %', min: 0.5, max: 15, decimals: true },
    { key: 'bodyScore', text: '76 kcal', min: 1, max: 100 },
    { key: 'bmi', text: '24.7 kg', min: 5, max: 80, decimals: true },
    { key: 'visceralFatLevel', text: '12 points', min: 1, max: 50 },
    { key: 'oaBodyMuscleMass', text: '27.4 %', min: 1, max: 100, decimals: true },
    { key: 'oaBodyFatMass', text: '11.8 kcal', min: 0.1, max: 80, decimals: true },
  ] as const;
  for (const { text, ...limits } of cases) {
    const row = { ...limits, centerY: 0 };
    const reads = [{ text, confidence: 95 }, { text, confidence: 94 }];
    assert.equal(numberFromText(text, row), undefined, `${row.key}: ${text}`);
    assert.equal(agreedNumber(reads, row), undefined, row.key);
    assert.equal(recoveredNumber([], reads, row), undefined, row.key);
  }
});

test('existing OA unit spellings, decimal spacing and unitless crops remain supported', () => {
  for (const [key, , unit] of OA_REPORT_INVENTORY) {
    if (['reportedBodyAge', 'bodyShape', 'measurementDate', 'measurementTime'].includes(key)) continue;
    const sourceKey = key === 'trunkMuscleMass' ? 'oaBodyMuscleMass' : key === 'trunkFatMass' ? 'oaBodyFatMass' : key;
    const row = { key: sourceKey as Parameters<typeof numberFromText>[1]['key'], centerY: 0, min: 0, max: 5000 };
    const suffix = unit === '포인트' ? 'points' : unit;
    assert.equal(numberFromText(`24.7 ${suffix}`, row), 24.7, key);
    assert.equal(numberFromText(` 24 , 7 ${suffix.toUpperCase()}\n`, row), 24.7, key);
    assert.equal(numberFromText('24.7', row), 24.7, key);
  }
  const score = { key: 'bodyScore' as const, centerY: 0, min: 1, max: 100 };
  assert.equal(numberFromText('76 point', score), 76);
  // Korean age units use their existing dedicated parser, not numeric guessing.
  assert.deepEqual(ageFromText('37 연 령 단 위'), { value: 37, unit: '연령 단위', text: '37 연 령 단 위' });
  for (const text of ['76 포인트', '76 points (normal)', '76% points']) assert.equal(numberFromText(text, score), undefined, text);
});

test('retries cannot discard an explicit conflicting unit from an original reading', () => {
  const row = { key: 'weight' as const, centerY: 0, min: 20, max: 300, decimals: true };
  const read = (text: string, confidence = 94) => ({ text, confidence });
  for (const confidence of [95, 12]) {
    assert.equal(recoveredNumber([read('82.4 %', confidence), read('82.4')], [read('82.4'), read('82.4 kg')], row), undefined);
  }
  assert.equal(recoveredNumber([read('82.4 kg', 42), read('82.4 kg', 55)], [read('82.4'), read('82.4 kg')], row), 82.4);
});

test('mixed-format OCR units cannot be erased by smaller unitless retries', () => {
  const row = { key: 'weight' as const, centerY: 0, min: 20, max: 300, decimals: true };
  const read = (text: string, confidence = 94) => ({ text, confidence });
  for (const suffix of ['lb', 'lbs', 'g', 'mg', 'oz', 'stone', 'kg/m²', '㎏', '킬로그램', '(lb)', 'kg (normal)', 'kg / lb', '％', '﹪', '٪', '‰', '‱', '؉', '؊']) {
    for (const confidence of [95, 12]) {
      const original = [read(`82.4 ${suffix}`, confidence), read('82.4')];
      const before = structuredClone(original);
      assert.equal(numberFromText(original[0].text, row), undefined, suffix);
      assert.equal(recoveredNumber(original, [read('82.4'), read('82.4 kg')], row), undefined, `${suffix}, confidence ${confidence}`);
      assert.deepEqual(original, before);
    }
  }
  // Recovery of unreadable punctuation, low confidence, or a supported unit is unchanged.
  for (const original of [[read('82:4'), read('82.4')], [read('82.4 KG', 12), read('82.4')]]) {
    assert.equal(recoveredNumber(original, [read('82.4'), read('82.4 kg')], row), 82.4);
  }
});

test('wrappers, prefixes and extra OCR lines cannot conceal unknown units from retries', () => {
  const row = { key: 'weight' as const, centerY: 0, min: 20, max: 300, decimals: true };
  for (const text of ['(82.4 lb)', '[82.4lb]', '• 82.4 lb', '+82.4lb', '-82.4lb', '82.4lb\nkg', '82.4\nlb', 'weight 82.4 lb', '82.4 (lb) normal', '82.4 %\nkg', '82.O kg', '８２.４ lb']) {
    for (const confidence of [95, 12]) {
      const original = [{ text, confidence }, { text: '82.4', confidence: 95 }];
      assert.equal(recoveredNumber(original, [{ text: '82.4', confidence: 95 }, { text: '82.4 kg', confidence: 95 }], row), undefined, `${text}, confidence ${confidence}`);
    }
  }
});

test('unknown-unit candidates preserve existing measurements and provenance until explicit correction', () => {
  const date = '2025-04-07';
  const weights = { [date]: { weight: 80.2, recordedAt: 'original' } };
  const source = { device: 'OA long report' as const, originalLabel: '체중', originalUnit: 'kg', originalText: '80.2kg', method: 'ocr' as const, mappingVersion: 'oa-pro-v1' as const };
  const inbody = { [date]: { bmi: 24.1, memo: 'synthetic existing record', metricSources: { weight: source } } };
  const before = structuredClone({ weights, inbody });
  const read = (text: string) => ({ text, confidence: 94 });
  const recovered = recoveredNumber([read('82.4 lb'), read('82.4')], [read('82.4'), read('82.4 kg')], { key: 'weight', centerY: 0, min: 20, max: 300, decimals: true });
  const patch = { bmi: '24.8', ...(recovered === undefined ? {} : { weight: String(recovered) }) };
  const saved = mergeBodyImport(weights, inbody, date, patch, '2026-10-27');
  assert.deepEqual(saved.weights, weights);
  assert.equal(saved.inbody[date].bmi, 24.8);
  assert.equal(saved.inbody[date].memo, inbody[date].memo);
  assert.deepEqual(saved.inbody[date].metricSources, inbody[date].metricSources);
  assert.deepEqual({ weights, inbody }, before);
  const corrected = mergeBodyImport(saved.weights, saved.inbody, date, { weight: '82.4' }, '2026-10-27');
  assert.equal(corrected.weights[date].weight, 82.4);
  assert.equal(corrected.inbody[date].metricSources?.weight?.originalText, '80.2kg');
});

test('unit-mismatched OCR candidates leave existing records and source text intact for manual review', () => {
  const date = '2025-04-07';
  const source = { device: 'OA long report' as const, originalLabel: '체지방률', originalUnit: '%', originalText: '23.6%', method: 'ocr' as const, mappingVersion: 'oa-pro-v1' as const };
  const weights = { [date]: { weight: 80.2, recordedAt: 'original' } };
  const inbody = { [date]: { bodyFatPercent: 23.6, memo: 'synthetic manual review', metricSources: { bodyFatPercent: source } } };
  const invalidRead = { text: '24.7 kg', confidence: 95 };
  const value = agreedNumber([invalidRead, invalidRead], { key: 'bodyFatPercent', centerY: 0, min: 1, max: 80, decimals: true });
  const mapped = mapOaMeasurements({ bmi: 24.8, ...(value === undefined ? {} : { bodyFatPercent: value }) });
  const patch = Object.fromEntries(Object.entries(mapped.values).map(([key, number]) => [key, String(number)]));
  const saved = mergeBodyImport(weights, inbody, date, patch, '2026-10-26');
  assert.deepEqual(saved.weights, weights);
  assert.deepEqual(saved.inbody[date], { ...inbody[date], bmi: 24.8 });
  const corrected = mergeBodyImport(saved.weights, saved.inbody, date, { bodyFatPercent: '24.7' }, '2026-10-26');
  assert.equal(corrected.inbody[date].bodyFatPercent, 24.7);
  assert.equal(corrected.inbody[date].metricSources?.bodyFatPercent?.method, 'ocr-edited');
  assert.equal(corrected.inbody[date].metricSources?.bodyFatPercent?.originalText, '23.6%');
  assert.equal(inbody[date].bodyFatPercent, 23.6);
  assert.equal(inbody[date].metricSources.bodyFatPercent.method, 'ocr');
});

test('multiline timestamp dates validate calendar and reject ambiguous headers', () => {
  assert.equal(dateFromText('fixture@example.test\n2025-04-07 08:12:34'), '2025-04-07');
  assert.equal(dateFromText('2025 / 4 / 7'), '2025-04-07');
  assert.equal(dateFromText('2025-02-30'), undefined);
  assert.equal(dateFromText('2025-04-07\n2025-04-08'), undefined);
  assert.equal(dateFromText(''), undefined);
});

test("항목 허용 범위를 벗어난 OCR 값은 저장 후보에서 제외한다", () => {
  assert.equal(
    numberFromText("9999", {
      key: "visceralFatLevel",
      centerY: 0,
      min: 1,
      max: 50,
    }),
    undefined,
  );
});

import { mapOaMeasurements } from './oaReportParser.ts';
import { ageFromText, timeFromText, shapeFromText } from './oaReportParser.ts';
import { OA_REPORT_INVENTORY } from './oaReportInventory.ts';
import { mergeBodyFields } from './bodyImport.ts';
import { mergeBodyImport } from './bodyImport.ts';

test('OA numeric transcription accepts a number without assigning clinical meaning', () => {
  assert.equal(agreedNumber([{text:'27.4kg',confidence:95},{text:'27.4kg',confidence:94}], {key:'oaBodyMuscleMass',centerY:0,min:1,max:100,decimals:true}),27.4);
});

test('OA ambiguous source rows remain draft-only; existing manual metrics survive save', () => {
  const mapped = mapOaMeasurements({oaBodyMuscleMass:27.4,oaBodyFatMass:11.8,fatMass:22.6,muscleMass:54.3});
  assert.deepEqual(mapped.values,{fatMass:22.6,muscleMass:54.3});
  assert.deepEqual(mapped.unmappedMeasurements,[{source:'OA',label:'신체 근육량',value:27.4,unit:'kg'},{source:'OA',label:'체지방량',value:11.8,unit:'kg'}]);
  const old = {'2025-04-07':{skeletalMuscleMass:31.7,bodyFatMass:20.3,memo:'manual fixture'}};
  const patch = Object.fromEntries(Object.entries(mapped.values).map(([k,v])=>[k,String(v)]));
  const saved = mergeBodyImport({},old,'2025-04-07',patch,'2026-10-18');
  assert.deepEqual(saved.inbody['2025-04-07'],{...old['2025-04-07'],fatMass:22.6,muscleMass:54.3});
  assert.deepEqual(old['2025-04-07'],{skeletalMuscleMass:31.7,bodyFatMass:20.3,memo:'manual fixture'});
  assert.deepEqual(mapOaMeasurements({skeletalMuscleMass:27.4,bodyFatMass:11.8}).values,{});
});

test('confirmed PRO trunk fields preserve per-metric provenance without clinical substitution', () => {
 const result=mapOaMeasurements({oaBodyMuscleMass:27.4,oaBodyFatMass:11.8},true);
 assert.deepEqual(result.values,{trunkMuscleMass:27.4,trunkFatMass:11.8});
 assert.deepEqual(result.unmappedMeasurements,[]);
 assert.equal(result.metricSources.trunkMuscleMass?.originalLabel,'신체 근육량');
 const patch=Object.fromEntries(Object.entries(result.values).map(([k,v])=>[k,String(v)]));
 const old={'2025-04-07':{skeletalMuscleMass:31.7,bodyFatMass:20.3}};
 const saved=mergeBodyImport({},old,'2025-04-07',patch,'2026-10-18',result.metricSources);
 assert.equal(saved.inbody['2025-04-07'].skeletalMuscleMass,31.7);
 assert.equal(saved.inbody['2025-04-07'].bodyFatMass,20.3);
 assert.deepEqual(saved.inbody['2025-04-07'].metricSources,result.metricSources);
});

test('source inventory covers 27 numeric items, shape, date and time independently', () => {
 assert.equal(OA_REPORT_INVENTORY.length,30);
 assert.equal(new Set(OA_REPORT_INVENTORY.map(row=>row[0])).size,30);
 assert.ok(OA_REPORT_INVENTORY.some(row=>row[0]==='standardWeight'));
 assert.ok(!OA_REPORT_INVENTORY.some(row=>String(row[0])==='skeletalMuscleMass'));
});

test('age requires the complete source unit; text and clock readings are not inferred', () => {
 assert.deepEqual(ageFromText('37 연 령 단 위'),{value:37,unit:'연령 단위',text:'37 연 령 단 위'});
 for(const text of ['37','37세','30대','37 연령','37 연령 단위 많다','137연령 단위']) assert.equal(ageFromText(text),undefined);
 assert.equal(timeFromText('2025-04-07 08:12:34'),'08:12:34');
 for(const text of ['24:00:00','08:60:00','08:12:60','08:12:34 09:12:34']) assert.equal(timeFromText(text),undefined);
 assert.equal(shapeFromText('건 강 형'),'건강형');
 assert.equal(shapeFromText('알 수 없음'),undefined);
});

test('new source fields survive both editor merge styles and JSON serialization without rewriting old records', () => {
 const old={bodyAge:52,skeletalMuscleMass:31.7,memo:'synthetic'};
 const patch={standardWeight:'61.2',reportedBodyAge:'37',reportedBodyAgeUnit:'연령 단위',bodyShape:'건강형',measurementTime:'08:12:34'};
 const source={device:'OA Smart Scale PRO' as const,originalLabel:'신체연령',originalText:'37연령 단위',method:'ocr' as const,mappingVersion:'oa-pro-v1' as const};
 const record=mergeBodyFields(old,patch,{reportedBodyAge:source});
 const serialized=JSON.parse(JSON.stringify(mergeBodyFields(record,{memo:'edited'})));
 for(const [key,value] of Object.entries(patch)) assert.equal(String(serialized[key]),value);
 assert.equal(serialized.bodyAge,52);assert.equal(serialized.skeletalMuscleMass,31.7);
 assert.deepEqual(old,{bodyAge:52,skeletalMuscleMass:31.7,memo:'synthetic'});
 const edited=mergeBodyFields(record,{reportedBodyAgeUnit:'원문 단위'});
 assert.equal(edited.metricSources?.reportedBodyAge?.method,'ocr-edited');
 assert.equal(edited.metricSources?.reportedBodyAge?.originalText,'37연령 단위');
 assert.throws(()=>mergeBodyFields(record,{measurementTime:'25:00:00'}));
 assert.equal(mergeBodyFields(record,{bodyShape:''}).bodyShape,undefined);
});


test('synthetic OA headers never substitute printing dates or discard invalid competing dates', () => {
  for (const text of [
    '인쇄일 2026-10-22', '출력일: 2026-10-22', 'Printed: 2026-10-22',
    '측정일 2026-10-21\n인쇄일 2026-10-22',
    '측정일 2026-02-30\n2026-10-22',
    '측정일 2026-10-22\n출력일 2026-10-22',
    '10/22/2026', '22/10/2026', '10/22', '2026-22-10', '',
  ]) assert.equal(dateFromText(text), undefined, text);
  assert.equal(dateFromText('측정일 2026-10-21'), '2026-10-21');
  assert.equal(dateFromText('2026/04/05'), '2026-04-05'); // Supported year/month/day only; never swap.
});
