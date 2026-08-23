import { speakJapaneseWithBrowserTts, type JapaneseTtsOptions } from "@/utils/japaneseTts";

type PreferredJapaneseTtsOptions = JapaneseTtsOptions & {
  apiPath?: string;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function speakJapaneseWithPreferredTts(text: string, options: PreferredJapaneseTtsOptions = {}) {
  if (!text) return;

  const repeatCount = Math.max(1, options.repeatCount ?? 1);
  const repeatDelayMs = Math.max(0, options.repeatDelayMs ?? 0);

  try {
    const res = await fetch(options.apiPath ?? "/api/language/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("TTS API error");
    const { audioContent } = (await res.json()) as { audioContent?: string };
    if (!audioContent) throw new Error("No audioContent");

    options.onStart?.();
    for (let i = 0; i < repeatCount; i += 1) {
      const audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
      audio.playbackRate = options.rate ?? 0.9;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("Audio playback failed"));
        audio.play().catch(reject);
      });
      if (i < repeatCount - 1 && repeatDelayMs > 0) {
        await wait(repeatDelayMs);
      }
    }
    options.onEnd?.();
    return;
  } catch {
    await speakJapaneseWithBrowserTts(text, options);
  }
}
