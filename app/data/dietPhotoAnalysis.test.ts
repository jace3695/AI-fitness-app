import assert from "node:assert/strict";
import test from "node:test";
import {
  isSupportedDietPhotoDataUrl,
  normalizeDietPhotoAnalysis,
  parseDietPhotoAnalysisText,
  proteinInputFromEstimate,
  riceInputFromEstimate,
  validateDietPhotoFile,
} from "./dietPhotoAnalysis.ts";

test("식단 사진 분석값은 표시 가능한 범위와 길이로 제한한다", () => {
  assert.deepEqual(normalizeDietPhotoAnalysis({
    foods: [" 닭가슴살 ", "닭가슴살", "밥", 123, "채소"],
    proteinGrams: 123.7,
    cookedRiceGrams: -20,
    vegetables: "enough",
    confidence: "high",
    note: "  사진에서 보이는 양을 기준으로 추정  ",
  }), {
    foods: ["닭가슴살", "밥", "채소"],
    proteinGrams: 100,
    cookedRiceGrams: 0,
    vegetables: "enough",
    confidence: "high",
    note: "사진에서 보이는 양을 기준으로 추정",
  });
});
test("코드 펜스가 있는 AI JSON도 파싱하고 빈 결과는 거부한다", () => {
  assert.deepEqual(parseDietPhotoAnalysisText('```json\n{"foods":["연어"],"proteinGrams":25,"cookedRiceGrams":80,"confidence":"medium"}\n```'), {
    foods: ["연어"], proteinGrams: 25, cookedRiceGrams: 80,
    vegetables: "unknown", confidence: "medium", note: "",
  });
  assert.equal(parseDietPhotoAnalysisText('{"foods":[],"proteinGrams":null,"cookedRiceGrams":null}'), null);
  assert.equal(parseDietPhotoAnalysisText("not json"), null);
});

test("사진 추정값은 기존 식단 입력 형식으로 명시적으로 변환한다", () => {
  assert.deepEqual(proteinInputFromEstimate(null), null);
  assert.deepEqual(proteinInputFromEstimate(25), { choice: "25", custom: 0 });
  assert.deepEqual(proteinInputFromEstimate(27), { choice: "custom", custom: 27 });
  assert.deepEqual(riceInputFromEstimate(0), { amountType: "none", grams: 0 });
  assert.deepEqual(riceInputFromEstimate(80), { amountType: "80", grams: 80 });
  assert.deepEqual(riceInputFromEstimate(127), { amountType: "custom", grams: 127 });
});

test("사진 파일과 data URL 형식·크기를 전송 전에 제한한다", () => {
  assert.equal(validateDietPhotoFile({ type: "image/jpeg", size: 2048 }), null);
  assert.match(validateDietPhotoFile({ type: "image/gif", size: 2048 }) ?? "", /JPG/);
  assert.match(validateDietPhotoFile({ type: "image/png", size: 13 * 1024 * 1024 }) ?? "", /12MB/);
  assert.equal(isSupportedDietPhotoDataUrl("data:image/jpeg;base64,aGVsbG8="), true);
  assert.equal(isSupportedDietPhotoDataUrl("data:text/plain;base64,aGVsbG8="), false);
});
