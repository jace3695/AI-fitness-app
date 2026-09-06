import { speakJapaneseWithBrowserTts, type JapaneseTtsOptions } from "./japaneseTts.ts";
import { authenticatedFetch } from "../lib/supabase.ts";

type PreferredJapaneseTtsOptions = JapaneseTtsOptions & {
  apiPath?: string;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class JapaneseAudioError extends Error {}

export function japaneseAudioErrorMessage(error: unknown) {
  return error instanceof JapaneseAudioError ? error.message : "소리를 재생하지 못했어요. 잠시 후 다시 시도하거나 읽는 법을 보며 계속해 주세요.";
}

export async function speakJapaneseWithPreferredTts(text: string, options: PreferredJapaneseTtsOptions = {}) {
  if (!text || options.signal?.aborted) return;

  const repeatCount = Math.max(1, options.repeatCount ?? 1);
  const repeatDelayMs = Math.max(0, options.repeatDelayMs ?? 0);
  let failureMessage = japaneseAudioErrorMessage(null);

  try {
    const apiPath = options.apiPath ?? "/api/language/tts";
    if (!apiPath.startsWith("/api/")) throw new Error("Invalid TTS endpoint");
    const res = await authenticatedFetch(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: options.signal,
    });
    if (!res.ok) {
      const failure = await res.json().catch(() => null);
      failureMessage = failure?.code === "TTS_NOT_CONFIGURED"
        ? "음성 서비스 설정이 아직 준비되지 않았어요. 읽는 법을 보며 계속 학습할 수 있어요."
        : res.status === 401 ? "음성 재생을 위해 로그인을 다시 확인해 주세요."
        : res.status === 402 ? "이번 달 AI 음성 사용 한도에 도달했어요. 읽는 법을 보며 계속 학습할 수 있어요."
        : res.status >= 500 ? "음성 서비스 연결에 문제가 있어요. 잠시 후 다시 시도하거나 읽는 법을 보며 계속해 주세요."
        : japaneseAudioErrorMessage(null);
      throw new Error("TTS API error");
    }
    const { audioContent } = (await res.json()) as { audioContent?: string };
    if (!audioContent) throw new Error("No audioContent");

    options.onStart?.();
    for (let i = 0; i < repeatCount; i += 1) {
      if (options.signal?.aborted) return;
      const audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
      audio.playbackRate = options.rate ?? 0.9;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => options.signal?.removeEventListener("abort", abort);
        const abort = () => { audio.pause(); cleanup(); resolve(); };
        options.signal?.addEventListener("abort", abort, { once: true });
        audio.onended = () => { cleanup(); resolve(); };
        audio.onerror = () => { cleanup(); reject(new Error("Audio playback failed")); };
        audio.play().catch((error) => { cleanup(); reject(error); });
      });
      if (i < repeatCount - 1 && repeatDelayMs > 0) {
        await wait(repeatDelayMs);
      }
    }
    if (!options.signal?.aborted) options.onEnd?.();
    return;
  } catch {
    if (options.signal?.aborted) return;
    try {
      await speakJapaneseWithBrowserTts(text, options);
    } catch {
      if (!options.signal?.aborted) throw new JapaneseAudioError(failureMessage);
    }
  }
}
