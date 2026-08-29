import assert from "node:assert/strict";
import test from "node:test";
import { buildAssistantSpeechText, selectKoreanVoice } from "./assistantVoice.ts";

test("연이 답변을 짧고 자연스러운 음성 문장으로 정리한다", () => {
  assert.equal(
    buildAssistantSpeechText({ reply: "**오늘 브리핑**\n할 일은 2건입니다. https://example.com/detail" }),
    "오늘 브리핑 할 일은 2건입니다. 화면의 링크",
  );
});

test("오류도 사용자가 이해할 수 있는 음성 안내로 바꾼다", () => {
  assert.equal(
    buildAssistantSpeechText({ error: "로그인이 필요합니다." }),
    "명령을 처리하지 못했어요. 로그인이 필요합니다.",
  );
});

test("한국어 여성 음성이 있으면 먼저 선택하고 없으면 한국어 기본 음성을 사용한다", () => {
  const voices = [
    { name: "English", lang: "en-US", default: true },
    { name: "한국어 기본", lang: "ko-KR", localService: true },
    { name: "Yuna", lang: "ko-KR" },
  ];
  assert.equal(selectKoreanVoice(voices)?.name, "Yuna");
  assert.equal(selectKoreanVoice(voices.slice(0, 2))?.name, "한국어 기본");
});
