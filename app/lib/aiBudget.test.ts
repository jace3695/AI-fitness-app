import assert from "node:assert/strict";
import test from "node:test";
import { conservativeTokenEstimate, standardTtsCostKrw, tokenCostKrw, ttsCostKrw } from "../../lib/ai-budget.ts";

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
