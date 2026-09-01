import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_BUDGET_THRESHOLDS,
  AiBudgetExceededError,
  buildAiBudgetSummary,
  conservativeTokenEstimate,
  getAiBudgetStatus,
  getAiUsageAppId,
  standardTtsCostKrw,
  tokenCostKrw,
  ttsCostKrw,
} from "../../lib/ai-budget.ts";

test("Gemini Flash-Lite token cost uses the conservative KRW rate", () => {
  assert.equal(tokenCostKrw("gemini-2.5-flash-lite", 1_000_000, 1_000_000), 750);
});

test("Gemini 3.7 Flash on-demand analysis uses current standard pricing", () => {
  assert.equal(tokenCostKrw("gemini-3.7-flash", 1_000_000, 1_000_000), 6750);
});

test("GPT-4o mini token cost is calculated independently", () => {
  assert.equal(tokenCostKrw("gpt-4o-mini", 1_000_000, 1_000_000), 1125);
});

test("Chirp HD TTS includes every input character", () => {
  assert.equal(ttsCostKrw(1_000), 45);
});

test("standard TTS uses the lower character rate", () => {
  assert.equal(standardTtsCostKrw(1_000), 6);
});

test("pre-call estimate never becomes zero", () => {
  assert.ok(conservativeTokenEstimate("안녕", 220, "gemini-2.5-flash-lite") >= 0.01);
});

test("월 예산 보호 단계는 70%, 85%, 95%로 동작한다", () => {
  assert.deepEqual(AI_BUDGET_THRESHOLDS, [70, 85, 95]);
  assert.equal(getAiBudgetStatus(69.9), "normal");
  assert.equal(getAiBudgetStatus(70), "notice");
  assert.equal(getAiBudgetStatus(85), "high_performance_limited");
  assert.equal(getAiBudgetStatus(95), "paid_ai_paused");
});

test("AI 사용량은 앱별로 안전하게 묶어 보여준다", () => {
  const summary = buildAiBudgetSummary([
    { feature: "assistant-fallback", cost_krw: 100 },
    { feature: "korean-tts", cost_krw: "40.5" },
    { feature: "fitness-weekly-plan-proposal", cost_krw: 8_300 },
    { feature: "budget-analysis", cost_krw: 60 },
    { feature: "language-conversation", cost_krw: 20 },
    { feature: "unknown-feature", cost_krw: 10 },
  ]);

  assert.equal(summary.spentKrw, 8_530.5);
  assert.equal(summary.status, "high_performance_limited");
  assert.equal(summary.reachedThreshold, 85);
  assert.deepEqual(summary.apps.map((app) => [app.id, app.spentKrw, app.usageCount]), [
    ["fitness", 8_300, 1],
    ["assistant", 140.5, 2],
    ["budget", 60, 1],
    ["language", 20, 1],
    ["other", 10, 1],
  ]);
});

test("앱별 사용량은 원본 프롬프트나 내용 대신 기능 범주만 사용한다", () => {
  assert.equal(getAiUsageAppId("fitness-weekly-report"), "fitness");
  assert.equal(getAiUsageAppId("japanese-tts"), "language");
  assert.equal(getAiUsageAppId("korean-tts"), "assistant");
  assert.equal(getAiUsageAppId("unregistered-feature"), "other");
});

test("95% 유료 AI 중지 메시지는 실제 제한 이유를 보존한다", () => {
  const error = new AiBudgetExceededError("paid_ai_paused");
  assert.equal(error.restriction, "paid_ai_paused");
  assert.match(error.message, /95%/);
});
