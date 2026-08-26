import assert from "node:assert/strict";
import test from "node:test";
import { numberFromText } from "./oaReportParser.ts";

test("오아 OCR의 쉼표 소수점과 유사 문자를 숫자로 보정한다", () => {
  assert.equal(
    numberFromText("83,O kg", {
      key: "weight",
      centerY: 0,
      min: 20,
      max: 300,
      decimals: true,
    }),
    83,
  );
});

test("소수점이 누락된 체지방률을 허용 범위로 복구한다", () => {
  assert.equal(
    numberFromText("299", {
      key: "bodyFatPercent",
      centerY: 0,
      min: 1,
      max: 80,
      decimals: true,
    }),
    29.9,
  );
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
