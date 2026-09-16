import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { japaneseAudioErrorMessage, speakJapaneseWithPreferredTts } from "../../utils/speakJapanese.ts";
import { speakJapaneseWithBrowserTts } from "../../utils/japaneseTts.ts";

function device(context: TestContext, onSpeak?: (utterance: SpeechSynthesisUtterance) => void, japanese = true) {
  const descriptors = ["window", "SpeechSynthesisUtterance"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const played: SpeechSynthesisUtterance[] = [];
  let cancelled = 0;
  const voices = [{ lang: japanese ? "ja-JP" : "en-US", name: "Remote voice", localService: false }, { lang: japanese ? "ja-JP" : "en-US", name: "Device voice", localService: true }];
  class Utterance { text: string; constructor(text: string) { this.text = text; } }
  const synth = { getVoices: () => voices, cancel: () => { cancelled++; }, speak: (utterance: SpeechSynthesisUtterance) => {
    played.push(utterance);
    if (onSpeak) onSpeak(utterance);
    else { utterance.onstart?.({} as SpeechSynthesisEvent); queueMicrotask(() => utterance.onend?.({} as SpeechSynthesisEvent)); }
  } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { speechSynthesis: synth } });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: Utterance });
  context.after(() => descriptors.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  const fetchMock = context.mock.method(globalThis, "fetch", async () => { throw new Error("Paid TTS must not be requested"); });
  return { played, cancelled: () => cancelled, fetchMock };
}

test("무료 음성은 서버를 호출하지 않고 설치된 일본어 음성을 우선 사용한다", async context => {
  const fixture = device(context);
  await speakJapaneseWithPreferredTts("こんにちは");
  assert.equal(fixture.played[0].voice?.localService, true);
  assert.equal(fixture.played[0].lang, "ja-JP");
  assert.equal(fixture.fetchMock.mock.calls.length, 0);
});
test("무료 음성도 반복 횟수와 시작·완료 콜백을 지킨다", async context => {
  const fixture = device(context); let started = 0; let ended = 0;
  await speakJapaneseWithPreferredTts("あ", { repeatCount: 3, onStart: () => { started++; }, onEnd: () => { ended++; } });
  assert.equal(fixture.played.length, 3); assert.equal(started, 1); assert.equal(ended, 1);
  assert.equal(fixture.fetchMock.mock.calls.length, 0);
});
test("이미 취소된 듣기는 기기와 API 모두 호출하지 않는다", async context => {
  const fixture = device(context); const request = new AbortController(); request.abort();
  await speakJapaneseWithPreferredTts("こんにちは", { signal: request.signal });
  assert.equal(fixture.played.length, 0); assert.equal(fixture.cancelled(), 0); assert.equal(fixture.fetchMock.mock.calls.length, 0);
});
test("재생 중 취소하면 반복과 완료 콜백이 멈춘다", async context => {
  const request = new AbortController(); let completed = 0;
  const fixture = device(context, () => request.abort());
  await speakJapaneseWithPreferredTts("あ", { signal: request.signal, repeatCount: 3, onEnd: () => { completed++; } });
  assert.equal(fixture.played.length, 1); assert.equal(completed, 0); assert.ok(fixture.cancelled() >= 2);
  assert.equal(fixture.fetchMock.mock.calls.length, 0);
});
test("일본어 음성이 없으면 다른 언어를 재생하거나 유료 음성으로 전환하지 않는다", async context => {
  const fixture = device(context, undefined, false);
  await assert.rejects(() => speakJapaneseWithPreferredTts("あ"), error => { assert.match(japaneseAudioErrorMessage(error), /기기의 일본어 음성/); return true; });
  assert.equal(fixture.played.length, 0); assert.equal(fixture.fetchMock.mock.calls.length, 0);
});
test("기기 재생 오류를 성공으로 처리하지 않는다", async context => {
  const fixture = device(context, utterance => utterance.onerror?.({} as SpeechSynthesisErrorEvent));
  await assert.rejects(() => speakJapaneseWithPreferredTts("あ"), error => { assert.match(japaneseAudioErrorMessage(error), /재생하지 못/); return true; });
  assert.equal(fixture.fetchMock.mock.calls.length, 0);
});
test("음성을 지원하지 않는 환경에서는 오류를 전달한다", async () => {
  await assert.rejects(() => speakJapaneseWithBrowserTts("こんにちは"), /음성 재생을 지원하지/);
});
