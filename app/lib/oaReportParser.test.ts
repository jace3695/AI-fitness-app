import assert from "node:assert/strict";
import test from "node:test";
import { numberFromText, dateFromText, agreedNumber } from "./oaReportParser.ts";

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
