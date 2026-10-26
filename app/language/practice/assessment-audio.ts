// Browser-local preparation only: no microphone, storage, URL or network access.
export const AZURE_AUDIO_POLICY_VERSION = 'azure-ja-accuracy-fluency-v1';
export type AssessmentDecodedAudio = Readonly<{ duration: number; sampleRate: number; length: number; numberOfChannels: number; getChannelData(channel: number): Float32Array }>;
export type AssessmentAudioDecoder = Readonly<{ decodeAudioData(bytes: ArrayBuffer): Promise<AssessmentDecodedAudio>; close(): Promise<void> }>;
const check = (signal: AbortSignal) => signal.throwIfAborted();
const yieldFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Bounded own working/output memory; the browser's native decode allocation is not
 * a controllable hard limit. No claim of Japanese scoring/quality validation. */
export async function encodeAssessmentWav(audio: AssessmentDecodedAudio, signal: AbortSignal): Promise<Blob> {
  check(signal);
  if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 30 || !Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 96000 || !Number.isInteger(audio.length) || audio.length <= 0 || audio.length > audio.sampleRate * 30 || Math.abs(audio.length / audio.sampleRate - audio.duration) > 1 / audio.sampleRate || ![1, 2].includes(audio.numberOfChannels)) throw Error('Unsupported decoded recording');
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  if (channels.some(channel => !(channel instanceof Float32Array) || channel.length !== audio.length)) throw Error('Unsupported channel');
  const count = Math.floor(audio.length * 16000 / audio.sampleRate);
  if (count < 1 || count > 480000) throw Error('Unsupported duration');
  const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true);
  const sample = (index: number) => {
    let sum = 0;
    for (const channel of channels) { const value = channel[index]; if (!Number.isFinite(value) || Math.abs(value) > 1) throw Error('Invalid sample'); sum += value; }
    return sum / channels.length;
  };
  const ratio = audio.sampleRate / 16000;
  for (let i = 0; i < count; i++) {
    if (i % 4096 === 0) { await yieldFrame(); check(signal); }
    let value = 0;
    if (ratio >= 1) {
      // Area average before reducing rate; avoids selecting just one stereo/sample lane.
      const start = i * ratio, end = Math.min((i + 1) * ratio, audio.length);
      for (let j = Math.floor(start); j < Math.ceil(end); j++) value += sample(j) * (Math.min(j + 1, end) - Math.max(j, start));
      value /= end - start;
    } else {
      const at = i * ratio, left = Math.floor(at), right = Math.min(left + 1, audio.length - 1), fraction = at - left;
      value = sample(left) * (1 - fraction) + sample(right) * fraction;
    }
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  check(signal); return new Blob([bytes], { type: 'audio/wav' });
}

export async function prepareAssessmentWav(blob: Blob, signal: AbortSignal, create: () => AssessmentAudioDecoder): Promise<Blob> {
  check(signal);
  if (!blob.size || blob.size > 5 * 1024 * 1024 || !['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'].includes(blob.type)) throw Error('Unsupported recording');
  const job = new AbortController(); let decoder: AssessmentAudioDecoder | undefined;
  const cancel = () => job.abort(); signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 15000);
  let rejectAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = () => reject(new DOMException('Cancelled', 'AbortError')); job.signal.addEventListener('abort', rejectAbort, { once: true }); });
  try {
    decoder = create();
    const run = async () => { const data = await blob.arrayBuffer(); check(job.signal); const audio = await decoder!.decodeAudioData(data); check(job.signal); return encodeAssessmentWav(audio, job.signal); };
    return await Promise.race([run(), cancelled]);
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', cancel); if (rejectAbort) job.signal.removeEventListener('abort', rejectAbort); job.abort();
    try { void decoder?.close().catch(() => {}); } catch { /* Native close must not hold cancellation. */ }
  }
}

/** Builds data for review only; caller must never dispatch without server readiness. */
export async function buildAssessmentEnvelope(wav: Blob, referenceText: string, requestId: string, consent: boolean, signal: AbortSignal) {
  check(signal);
  if (!consent || !referenceText.trim() || referenceText.length > 1000 || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId) || wav.type !== 'audio/wav' || wav.size < 46 || wav.size > 960044) throw Error('Review and consent required');
  const bytes = new Uint8Array(await wav.arrayBuffer()); check(signal);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) { await yieldFrame(); check(signal); binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384)); }
  return { requestId, language: 'ja-JP', referenceText: referenceText.trim(), audioMime: 'audio/wav', audioBase64: btoa(binary), consent: { confirmed: true, requestId, providerId: 'azure-speech', policyVersion: AZURE_AUDIO_POLICY_VERSION } };
}
