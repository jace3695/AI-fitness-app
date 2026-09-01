import assert from "node:assert/strict";
import test from "node:test";
import { AI_ROUTE_POLICIES, clampAiOutputTokens, getEconomyFallbackRoute, resolveAiRoute } from "../../lib/ai-router-policy.ts";

test("저비용 일반 분석은 Gemini 경량 모델로 연결한다", () => {
  for (const feature of ["assistant-fallback", "budget-analysis", "legacy-ai-analysis"] as const) {
    assert.deepEqual(resolveAiRoute(feature), {
      provider: "google",
      model: "gemini-2.5-flash-lite",
      maxOutputTokens: 2_000,
      environmentVariable: "GEMINI_API_KEY",
    });
  }
});

test("운동 코치 기능은 정밀 분석 모델로 일관되게 연결한다", () => {
  const fitnessFeatures = Object.keys(AI_ROUTE_POLICIES).filter((feature) => feature.startsWith("fitness-"));
  assert.equal(fitnessFeatures.length, 6);
  for (const feature of fitnessFeatures) {
    const route = AI_ROUTE_POLICIES[feature as keyof typeof AI_ROUTE_POLICIES];
    assert.equal(route.provider, "google");
    assert.equal(route.model, "gemini-3.7-flash");
  }
});

test("일본어 회화와 이미지 평가는 OpenAI JSON 경로를 사용한다", () => {
  assert.equal(resolveAiRoute("language-conversation").provider, "openai");
  assert.equal(resolveAiRoute("handwriting-feedback").model, "gpt-4o-mini");
});

test("기능별 출력 토큰 한도를 넘지 않도록 보정한다", () => {
  assert.equal(clampAiOutputTokens("assistant-fallback", 0), 1);
  assert.equal(clampAiOutputTokens("assistant-fallback", 9_999), 2_000);
  assert.equal(clampAiOutputTokens("fitness-weekly-plan-proposal", 2_400), 2_400);
  assert.equal(clampAiOutputTokens("fitness-program-review", 9_999), 2_600);
  assert.equal(clampAiOutputTokens("language-conversation", Number.NaN), 600);
});

test("85% 절약 모드에서는 운동 코치만 경량 Gemini로 전환한다", () => {
  const fitnessFallback = getEconomyFallbackRoute(resolveAiRoute("fitness-weekly-plan-proposal"));
  assert.equal(fitnessFallback?.provider, "google");
  assert.equal(fitnessFallback?.model, "gemini-2.5-flash-lite");
  assert.equal(getEconomyFallbackRoute(resolveAiRoute("language-conversation")), null);
});
