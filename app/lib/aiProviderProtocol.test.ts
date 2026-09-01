import assert from "node:assert/strict";
import test from "node:test";
import { buildGeminiGenerationConfig, extractGeminiResponse, readAiProviderFailure } from "../../lib/ai-provider-protocol.ts";

test("Gemini 구조화 출력은 REST enum MIME 형식을 사용한다", () => {
  const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
  const config = buildGeminiGenerationConfig({
    model: "gemini-3.7-flash",
    responseFormat: "json",
    jsonSchema: schema,
    temperature: 0.25,
    maxOutputTokens: 900,
  });

  assert.deepEqual(config.responseFormat, {
    text: { mimeType: "APPLICATION_JSON", schema },
  });
  assert.deepEqual(config.thinkingConfig, { thinkingLevel: "low", includeThoughts: false });
  assert.doesNotMatch(JSON.stringify(config), /application\/json/);
});

test("Gemini 2.5 절약 모델에는 3세대 사고 수준을 보내지 않는다", () => {
  const config = buildGeminiGenerationConfig({
    model: "gemini-2.5-flash-lite",
    responseFormat: "json",
    maxOutputTokens: 900,
  });

  assert.equal(config.thinkingConfig, undefined);
});

test("Gemini의 여러 답변 조각을 합치고 사고 조각은 제외한다", () => {
  const output = extractGeminiResponse({
    candidates: [{
      finishReason: "MAX_TOKENS",
      content: {
        parts: [
          { thought: true, text: "private reasoning" },
          { text: "{\"answer\":" },
          { thoughtSignature: "opaque" },
          { text: "\"완료\"}" },
        ],
      },
    }],
    usageMetadata: {
      promptTokenCount: 420,
      candidatesTokenCount: 180,
      thoughtsTokenCount: 75,
    },
  }, "json");

  assert.equal(output.text, "{\"answer\":\"완료\"}");
  assert.equal(output.inputTokens, 420);
  assert.equal(output.outputTokens, 180);
  assert.equal(output.billableOutputTokens, 255);
  assert.deepEqual(output.diagnostics, {
    finishReason: "MAX_TOKENS",
    thoughtTokens: 75,
    partCount: 4,
    answerTextPartCount: 2,
    thoughtTextPartCount: 1,
  });
  assert.doesNotMatch(output.text, /private reasoning/);
});

test("AI 제공자 오류에서 안전한 상태와 설명만 추출한다", async () => {
  const response = new Response(JSON.stringify({
    error: {
      code: 400,
      status: "INVALID_ARGUMENT",
      message: "Invalid MIME type. key=AIza12345678901234567890",
      details: [{ privateRequestBody: "운동 기록" }],
    },
  }), { status: 400 });

  const details = await readAiProviderFailure(response);
  assert.equal(details.code, "INVALID_ARGUMENT");
  assert.equal(details.message, "Invalid MIME type. key=[redacted]");
  assert.doesNotMatch(JSON.stringify(details), /운동 기록|AIza/);
});

test("비정형 제공자 오류 본문은 로그용 설명으로 노출하지 않는다", async () => {
  const response = new Response("request included private workout data", { status: 502 });
  assert.deepEqual(await readAiProviderFailure(response), {});
});
