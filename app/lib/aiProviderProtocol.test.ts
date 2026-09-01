import assert from "node:assert/strict";
import test from "node:test";
import { buildGeminiGenerationConfig, readAiProviderFailure } from "../../lib/ai-provider-protocol.ts";

test("Gemini 구조화 출력은 REST enum MIME 형식을 사용한다", () => {
  const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
  const config = buildGeminiGenerationConfig({
    responseFormat: "json",
    jsonSchema: schema,
    temperature: 0.25,
    maxOutputTokens: 900,
  });

  assert.deepEqual(config.responseFormat, {
    text: { mimeType: "APPLICATION_JSON", schema },
  });
  assert.doesNotMatch(JSON.stringify(config), /application\/json/);
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
