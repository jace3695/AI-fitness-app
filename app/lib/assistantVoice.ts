type VoiceCandidate = {
  name: string;
  lang: string;
  default?: boolean;
  localService?: boolean;
};

type AssistantSpeechSource = {
  reply?: string;
  error?: string;
};

const PREFERRED_KOREAN_VOICE = /(yuna|유나|sora|소라|sunhi|선희)/i;

export function buildAssistantSpeechText(source: AssistantSpeechSource) {
  const raw = source.error
    ? `명령을 처리하지 못했어요. ${source.error}`
    : source.reply || "연이의 답변이 없습니다.";

  return raw
    .replace(/https?:\/\/\S+/gi, "화면의 링크")
    .replace(/[`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

export function selectKoreanVoice<T extends VoiceCandidate>(voices: readonly T[]): T | undefined {
  const koreanVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith("ko"));
  return koreanVoices.find((voice) => PREFERRED_KOREAN_VOICE.test(voice.name))
    ?? koreanVoices.find((voice) => voice.default)
    ?? koreanVoices.find((voice) => voice.localService)
    ?? koreanVoices[0]
    ?? voices.find((voice) => voice.default);
}
