import { speakJapaneseWithBrowserTts, type JapaneseTtsOptions } from "./japaneseTts.ts";
import { authenticatedFetch } from "../lib/supabase.ts";

type PreferredJapaneseTtsOptions = JapaneseTtsOptions & {
  apiPath?: string;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function speakJapaneseWithPreferredTts(text: string, options: PreferredJapaneseTtsOptions = {}) {
  if (!text || options.signal?.aborted) return;

  const repeatCount = Math.max(1, options.repeatCount ?? 1);
  const repeatDelayMs = Math.max(0, options.repeatDelayMs ?? 0);

  try {
    const apiPath = options.apiPath ?? "/api/language/tts";
    if (!apiPath.startsWith("/api/")) throw new Error("Invalid TTS endpoint");
    const res = await authenticatedFetch(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: options.signal,
    });
    if (!res.ok) throw new Error("TTS API error");
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
    await speakJapaneseWithBrowserTts(text, options);
  }
}
