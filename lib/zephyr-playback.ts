import { YEONI_VOICE_NAME, YEONI_VOICE_PENDING_MESSAGE } from './yeoni-voice-policy.ts';

export function prepareZephyrSpeech(value: string) {
  const clean = value.replace(/https?:\/\/\S+/g, '화면의 링크')
    .replace(/[*#_~`]/g, '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(clean);
  return { text: characters.slice(0, 1200).join(''), characters: Math.min(characters.length, 1200), truncated: characters.length > 1200 };
}

type AudioResult = { audioContent: string; remainingCharacters: number };
type Dependencies = {
  request: (init: RequestInit) => Promise<Response>;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now?: Date;
  // Short workout cues may survive a reload in this tab. General answers do not.
  retainWorkoutAudio?: boolean;
};

// General answers stay in memory. Short workout cues can opt into tab storage.
// Losing an audio response must never create a fresh billable request on reload.
export class ZephyrAudioCache {
  private entries = new Map<string, Promise<AudioResult>>();

  clear() { this.entries.clear(); }

  async get(owner: string, text: string, dependencies: Dependencies): Promise<AudioResult> {
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(dependencies.now ?? new Date());
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([owner, month, YEONI_VOICE_NAME, text])));
    const key = 'yeoni-zephyr-attempt-v1:' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    const cached = this.entries.get(key);
    if (cached) return cached;
    const pending = this.generate(key, text, dependencies);
    this.entries.set(key, pending);
    if (this.entries.size > 8) this.entries.delete(this.entries.keys().next().value!);
    try { return await pending; }
    catch (error) { if (this.entries.get(key) === pending) this.entries.delete(key); throw error; }
  }

  private async generate(key: string, text: string, { request, storage, retainWorkoutAudio }: Dependencies): Promise<AudioResult> {
    const characters = Array.from(text).length;
    if (!characters || characters > 1200) throw new Error('읽을 답변을 확인해 주세요.');
    let previous: string | null;
    try { previous = storage.getItem(key); }
    catch { throw new Error('중복 생성 방지 기록을 보관할 수 없어 음성을 생성하지 않았어요.'); }
    if (previous) {
      if (retainWorkoutAudio && characters <= 200) {
        try {
          const saved = JSON.parse(previous);
          if (saved.voice === YEONI_VOICE_NAME && typeof saved.audioContent === 'string' && saved.audioContent.length <= 600_000
            && /^[A-Za-z0-9+/]+={0,2}$/.test(saved.audioContent)
            && Number.isSafeInteger(saved.remainingCharacters) && saved.remainingCharacters >= 0) {
            return { audioContent: saved.audioContent, remainingCharacters: saved.remainingCharacters };
          }
        } catch { /* An attempt receipt alone must never trigger another synthesis. */ }
      }
      throw new Error('이 답변은 이미 음성 생성을 요청했어요. 중복 생성을 막기 위해 다시 요청하지 않아요.');
    }

    const statusResponse = await request({ method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    const status = await statusResponse.json();
    if (!statusResponse.ok || status.enabled !== true || status.voice !== YEONI_VOICE_NAME || status.useDeviceVoice !== false) {
      throw new Error(status.error || status.message || (status.code === 'MONTH_LIMIT' ? '이번 달 음성 사용 한도에 도달했어요.' : YEONI_VOICE_PENDING_MESSAGE));
    }
    if (!Number.isSafeInteger(status.remainingCharacters) || status.remainingCharacters < characters) throw new Error('남은 음성 문자수가 이 답변보다 적어요. 화면의 답변을 확인해 주세요.');

    const requestId = crypto.randomUUID();
    try {
      storage.setItem(key, requestId);
      if (storage.getItem(key) !== requestId) throw new Error('STORAGE_UNAVAILABLE');
    } catch { throw new Error('중복 생성 방지 기록을 보관할 수 없어 음성을 생성하지 않았어요.'); }

    // No retry, including a timeout or an ambiguous provider response.
    const response = await request({ method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(45_000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, requestId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '음성 생성 완료 여부를 확인하지 못했어요. 추가 생성은 멈췄어요.');
    if (data.voice !== YEONI_VOICE_NAME || data.useDeviceVoice !== false || data.requestId !== requestId
      || typeof data.audioContent !== 'string' || !data.audioContent || data.audioContent.length > 8_000_000
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audioContent)
      || !Number.isSafeInteger(data.remainingCharacters) || data.remainingCharacters < 0) {
      throw new Error('생성된 음성을 확인하지 못했어요. 추가 생성은 멈췄어요.');
    }
    const result = { audioContent: data.audioContent, remainingCharacters: data.remainingCharacters };
    if (retainWorkoutAudio && characters <= 200 && data.audioContent.length <= 600_000) {
      // Best effort: quota failure leaves the original receipt and memory audio intact.
      // The owner/month/text hash keeps this separate from records and other accounts.
      try { storage.setItem(key, JSON.stringify({ requestId, voice: YEONI_VOICE_NAME, ...result })); } catch { /* No retry. */ }
    }
    return result;
  }
}
