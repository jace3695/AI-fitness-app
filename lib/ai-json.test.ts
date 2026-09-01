import assert from "node:assert/strict";
import test from "node:test";
import { parseAiJsonObject } from "./ai-json.ts";

test("AI JSON 코드 블록과 앞뒤 설명을 안전하게 읽는다", () => {
  assert.deepEqual(parseAiJsonObject("결과입니다.\n```json\n{\"status\":\"ok\",\"count\":2}\n```"), { status: "ok", count: 2 });
});

test("끊긴 AI JSON은 추측으로 완성하지 않는다", () => {
  assert.equal(parseAiJsonObject('{"status":"ok","summary":"중간에 끊김'), null);
});
