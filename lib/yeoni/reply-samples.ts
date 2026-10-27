import korean from '../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';
import japanese from '../../docs/yeoni-phase12/gemini-candidate/alignment/timeline.json';
import { parseLipSyncManifest } from './lip-sync.ts';
import type { ReplyClip } from './reply-session';

export const REPLY_SAMPLES = Object.freeze({ ko: parseLipSyncManifest(korean), ja: parseLipSyncManifest(japanese) });
export function savedReplyClips(audio: Readonly<{ ko: string; ja: string }>): readonly ReplyClip[] {
  return (['ko', 'ja'] as const).map(language => {
    // Own the existing inline data; don't retain a mutable caller-owned lookup.
    const encoded = audio[language];
    return { manifest: REPLY_SAMPLES[language], async load(signal: AbortSignal) {
      signal.throwIfAborted();
      return { bytes: Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer,
        mime: language === 'ko' ? 'audio/mpeg' : 'audio/wav' };
    } };
  });
}
