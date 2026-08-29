import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalMemoryContext, normalizeConversationHistory, selectConversationHistory } from "./assistantConversation.ts";

test("저장된 대화는 최근 메시지만 안전하게 정리한다", () => {
  const input = [
    { role: "user", content: " 첫 질문 " },
    { role: "tool", content: "무시" },
    { role: "assistant", content: " 첫 답변 " },
  ];
  assert.deepEqual(normalizeConversationHistory(input), [
    { role: "user", text: "첫 질문" },
    { role: "assistant", text: "첫 답변" },
  ]);
});

test("서버 저장 대화가 있으면 클라이언트 임시 기록보다 우선한다", () => {
  assert.deepEqual(
    selectConversationHistory([{ role: "user", content: "저장된 질문" }], [{ role: "user", text: "임시 질문" }]),
    [{ role: "user", text: "저장된 질문" }],
  );
  assert.deepEqual(
    selectConversationHistory([], [{ role: "user", text: "임시 질문" }]),
    [{ role: "user", text: "임시 질문" }],
  );
});

test("개인 기억은 모델에 전달할 짧은 목록으로 만든다", () => {
  assert.equal(
    buildPersonalMemoryContext([
      { topic: "운동", content: " 허리 부담이 큰 운동은 피한다. " },
      { topic: "", content: "아이폰을 사용한다." },
    ]),
    "- 운동: 허리 부담이 큰 운동은 피한다.\n- 일반: 아이폰을 사용한다.",
  );
});
