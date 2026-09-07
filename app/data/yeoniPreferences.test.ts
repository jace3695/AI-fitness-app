import assert from "node:assert/strict";
import test from "node:test";
import { parseYeoniPreferences, resolveYeoniMotion } from "../../utils/yeoniPreferences.ts";

test("연이 설정이 없거나 손상돼도 반복 움직임을 기본으로 켜지 않는다", () => {
  for (const raw of [null, "broken", "[]", "null", '{"motion":"unknown"}']) {
    assert.deepEqual(parseYeoniPreferences(raw), { visible: true, motion: "reactions" });
  }
});

test("기존 일본어의 숨김·정지 선택을 공통 설정의 초기값으로 보존한다", () => {
  assert.deepEqual(parseYeoniPreferences(null, '{"showCompanion":false,"homeCompanionMotion":false}'), { visible: false, motion: "off" });
  assert.deepEqual(parseYeoniPreferences("broken", '{"homeCompanionMotion":false}'), { visible: true, motion: "off" });
  assert.deepEqual(parseYeoniPreferences('{"visible":true,"motion":"home"}', '{"showCompanion":false}'), { visible: true, motion: "home" });
});

test("숨김·전체 정지·집중 화면은 홈 반복보다 우선하고 학습 반응은 반복하지 않는다", () => {
  assert.equal(resolveYeoniMotion({ visible: false, motion: "home" }, "ambient"), "off");
  assert.equal(resolveYeoniMotion({ visible: true, motion: "off" }, "once"), "off");
  assert.equal(resolveYeoniMotion({ visible: true, motion: "home" }, "off"), "off");
  assert.equal(resolveYeoniMotion({ visible: true, motion: "home" }, "once"), "once");
  assert.equal(resolveYeoniMotion({ visible: true, motion: "reactions" }, "ambient"), "once");
  assert.equal(resolveYeoniMotion({ visible: true, motion: "home" }, "ambient"), "ambient");
});
