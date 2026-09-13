import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFreeDietPhoto, FREE_DIET_PHOTO_MODEL, FREE_DIET_PHOTO_QUOTA_MESSAGE,
  FreeDietPhotoError, isFreeDietPhotoConfigured,
} from "./diet-photo-free-ai.ts";

const configured = { GEMINI_FREE_API_KEY: "SYNTHETIC_FREE_KEY", GEMINI_FREE_TIER_CONFIRMED: "true" };
const input = { mealSlot: "lunch", imageDataUrl: "data:image/png;base64,YWJj", freeDataUseAcknowledged: true };
const analysis = { foods: ["밥", "닭가슴살"], proteinGrams: 27, cookedRiceGrams: 130, vegetables: "some", confidence: "medium", note: "추정값" };
const okResponse = (finishReason = "STOP") => Response.json({
  candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(analysis) }] } }],
  usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 100 },
});

test("무료 확인과 전용 키가 모두 있어야 하며 기존 유료 키로 대체하지 않는다", async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls += 1; return okResponse(); };
  for (const environment of [
    {}, { GEMINI_API_KEY: "SYNTHETIC_PAID_KEY", OPENAI_API_KEY: "SYNTHETIC_OPENAI_KEY" },
    { GEMINI_FREE_API_KEY: "SYNTHETIC_FREE_KEY" },
    { GEMINI_FREE_TIER_CONFIRMED: "true", GEMINI_API_KEY: "SYNTHETIC_PAID_KEY" },
    { ...configured, GEMINI_FREE_API_KEY: " " },
    { ...configured, GEMINI_FREE_TIER_CONFIRMED: "false" },
  ]) {
    assert.equal(isFreeDietPhotoConfigured(environment), false);
    await assert.rejects(analyzeFreeDietPhoto(input, environment, request), (error: unknown) =>
      error instanceof FreeDietPhotoError && error.category === "not_configured" && error.status === 503);
  }
  assert.equal(calls, 0);
});

test("사진 형식과 무료 데이터 활용 확인을 검증한 뒤에만 외부 요청을 허용한다", async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls += 1; return okResponse(); };
  for (const change of [
    { mealSlot: "breakfast" }, { imageDataUrl: 123 }, { imageDataUrl: "https://example.com/photo.png" },
    { freeDataUseAcknowledged: undefined }, { freeDataUseAcknowledged: "true" },
  ]) {
    await assert.rejects(analyzeFreeDietPhoto({ ...input, ...change }, configured, request), (error: unknown) =>
      error instanceof FreeDietPhotoError && error.status === 400);
  }
  assert.equal(calls, 0);
});

test("사진 한 장을 무료 전용 Gemini에 한 번 전송하고 정규화된 추정값만 반환한다", async () => {
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const request: typeof fetch = async (url, options) => { calls.push({ url: String(url), options }); return okResponse(); };
  assert.deepEqual(await analyzeFreeDietPhoto(input, configured, request), analysis);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${FREE_DIET_PHOTO_MODEL}:generateContent`);
  const options = calls[0].options!;
  assert.equal(new Headers(options.headers).get("x-goog-api-key"), configured.GEMINI_FREE_API_KEY);
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
  assert.ok(options.signal instanceof AbortSignal);
  const body = JSON.parse(String(options.body));
  assert.deepEqual(body.contents[0].parts[1], { inline_data: { mime_type: "image/png", data: "YWJj" } });
  assert.equal(body.contents.length, 1);
  assert.equal(body.contents[0].parts.length, 2);
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0, includeThoughts: false });
  assert.equal(body.generationConfig.maxOutputTokens, 350);
  assert.equal(body.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
  assert.equal(body.store, false);
  assert.equal(body.tools, undefined);
  assert.equal(body.cachedContent, undefined);
});

test("무료 한도 오류에서 재시도·유료 전환 없이 직접 입력을 안내한다", async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls += 1; return Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "provider-private-payload" } }, { status: 429 }); };
  await assert.rejects(analyzeFreeDietPhoto(input, configured, request), (error: unknown) => {
    assert.ok(error instanceof FreeDietPhotoError);
    assert.equal(error.message, FREE_DIET_PHOTO_QUOTA_MESSAGE);
    assert.equal(error.status, 429);
    assert.equal(error.providerCode, "RESOURCE_EXHAUSTED");
    assert.equal(JSON.stringify(error).includes("provider-private-payload"), false);
    return true;
  });
  assert.equal(calls, 1);
});

test("연결·권한 오류의 원문을 노출하지 않으며 실패를 자동 재요청하지 않는다", async () => {
  for (const failure of ["network", "permission"] as const) {
    let calls = 0;
    const request: typeof fetch = async () => {
      calls += 1;
      if (failure === "network") throw new Error("private-key-and-photo");
      return Response.json({ error: { status: "PERMISSION_DENIED", message: "private-key-and-photo" } }, { status: 403 });
    };
    await assert.rejects(analyzeFreeDietPhoto(input, configured, request), (error: unknown) =>
      error instanceof FreeDietPhotoError && error.status === 503 && !error.message.includes("private-key-and-photo"));
    assert.equal(calls, 1);
  }
});

test("잘린 답변·차단·잘못된 JSON을 정상 추정값으로 사용하지 않는다", async () => {
  for (const response of [okResponse("MAX_TOKENS"), Response.json({ promptFeedback: { blockReason: "SAFETY" } }), new Response("not-json")]) {
    const request: typeof fetch = async () => response;
    await assert.rejects(analyzeFreeDietPhoto(input, configured, request), (error: unknown) =>
      error instanceof FreeDietPhotoError && error.status === 422);
  }
});
