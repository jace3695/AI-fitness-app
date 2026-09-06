import assert from "node:assert/strict";
import test from "node:test";
import { speakJapaneseWithPreferredTts } from "../../utils/speakJapanese.ts";
import { speakJapaneseWithBrowserTts } from "../../utils/japaneseTts.ts";
import { createClient } from "../../lib/supabase.ts";

test("일본어 음성 API에 현재 계정 인증을 전달한다", async (context) => {
  const client = createClient();
  context.mock.method(client.auth, "getSession", async () => ({ data: { session: { access_token: "test-only-access-token" } }, error: null }));
  const request = new AbortController();
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
    assert.equal(input, "/api/language/tts");
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer test-only-access-token");
    request.abort();
    throw new DOMException("Cancelled", "AbortError");
  });
  await speakJapaneseWithPreferredTts("あ", { signal: request.signal });
});

test("취소된 듣기는 API를 호출하거나 다른 음성으로 대체하지 않는다", async (context) => {
  const request = new AbortController();
  request.abort();
  const fetchMock = context.mock.method(globalThis, "fetch", async () => { throw new Error("Must not fetch"); });
  await speakJapaneseWithPreferredTts("こんにちは", { signal: request.signal });
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("음성 다운로드 중 취소하면 일본어 TTS로 재시작하지 않는다", async (context) => {
  const request = new AbortController();
  context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, options?: RequestInit) => {
    assert.equal(options?.signal, request.signal);
    request.abort();
    throw new DOMException("Cancelled", "AbortError");
  });
  await assert.doesNotReject(() => speakJapaneseWithPreferredTts("こんにちは", { signal: request.signal }));
});

test("일본어 음성이 없는 환경에서는 성공으로 가장하지 않고 오류를 전달한다", async () => {
  await assert.rejects(() => speakJapaneseWithBrowserTts("こんにちは"), /음성 재생을 지원하지/);
});

test("재생 중 취소하면 현재 오디오를 멈추고 반복·완료 콜백을 실행하지 않는다", async (context) => {
  const request = new AbortController();
  let paused = 0;
  let played = 0;
  let completed = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  class FakeAudio {
    playbackRate = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    pause() { paused += 1; }
    async play() { played += 1; request.abort(); }
  }
  Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ audioContent: "fake" }), { status: 200 }));
  try {
    await speakJapaneseWithPreferredTts("あ", { signal: request.signal, repeatCount: 3, onEnd: () => { completed += 1; } });
    assert.equal(paused, 1);
    assert.equal(played, 1);
    assert.equal(completed, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, "Audio", previous);
    else Reflect.deleteProperty(globalThis, "Audio");
  }
});
