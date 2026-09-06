export type JapaneseTtsOptions = {
  rate?: number;
  pitch?: number;
  repeatCount?: number;
  repeatDelayMs?: number;
  onStart?: () => void;
  onEnd?: () => void;
  signal?: AbortSignal;
};

const VOICE_NAME_HINTS = ["japanese", "japan", "kyoko", "otoya", "haruka", "nanami"];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function clampRate(rate?: number) {
  if (typeof rate !== "number" || Number.isNaN(rate)) return 0.9;
  return Math.min(1, Math.max(0.8, rate));
}

function getBestJapaneseVoice(voices: SpeechSynthesisVoice[]) {
  const exactLang = voices.filter((voice) => voice.lang?.toLowerCase() === "ja-jp");
  if (exactLang.length > 0) {
    return exactLang.find((voice) => !voice.localService) ?? exactLang[0];
  }

  const jaLang = voices.filter((voice) => voice.lang?.toLowerCase().startsWith("ja"));
  if (jaLang.length > 0) {
    return jaLang.find((voice) => !voice.localService) ?? jaLang[0];
  }

  const byName = voices.find((voice) =>
    VOICE_NAME_HINTS.some((hint) => voice.name.toLowerCase().includes(hint))
  );
  if (byName) return byName;

  return null;
}

async function getVoicesWithFallback(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];

  const synth = window.speechSynthesis;
  const immediate = synth.getVoices();
  if (immediate.length > 0) return immediate;

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(synth.getVoices());
    };

    const onVoicesChanged = () => done();
    synth.addEventListener("voiceschanged", onVoicesChanged);
    setTimeout(done, 500);
  });
}

export async function speakJapaneseWithBrowserTts(text: string, options: JapaneseTtsOptions = {}) {
  if (!text || options.signal?.aborted) return;
  if (typeof window === "undefined" || !window.speechSynthesis) throw new Error("음성 재생을 지원하지 않는 브라우저입니다.");

  const synth = window.speechSynthesis;
  const repeatCount = Math.max(1, options.repeatCount ?? 1);
  const repeatDelayMs = Math.max(0, options.repeatDelayMs ?? 0);
  const rate = clampRate(options.rate);
  const pitch = options.pitch ?? 1;

  synth.cancel();
  const voices = await getVoicesWithFallback();
  const selectedVoice = getBestJapaneseVoice(voices);
  if (options.signal?.aborted) return;
  if (!selectedVoice) throw new Error("기기에 일본어 음성이 없습니다.");

  for (let i = 0; i < repeatCount; i += 1) {
    if (options.signal?.aborted) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = rate;
    utterance.pitch = pitch;
    if (selectedVoice) utterance.voice = selectedVoice;
    if (i === 0 && options.onStart) utterance.onstart = options.onStart;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => options.signal?.removeEventListener("abort", abort);
      const abort = () => { clearTimeout(timer); synth.cancel(); cleanup(); resolve(); };
      const timer = setTimeout(() => { if (!options.signal?.aborted) synth.speak(utterance); }, 50);
      utterance.onend = () => { cleanup(); resolve(); };
      utterance.onerror = () => { cleanup(); if (options.signal?.aborted) resolve(); else reject(new Error("음성을 재생하지 못했습니다.")); };
      options.signal?.addEventListener("abort", abort, { once: true });
    });

    if (i < repeatCount - 1 && repeatDelayMs > 0) {
      await wait(repeatDelayMs);
    }
  }

  if (!options.signal?.aborted) options.onEnd?.();
}
