/** Local eligibility only. Read at most the canonical WAV header; never upload,
 * record, store or analyze pronunciation here. Server validation remains required. */
export const ASSESSMENT_TRIAL = Object.freeze({ referenceText: 'こんにちは。', maxDurationMs: 5000 });
const HEADER_BYTES = 44;
const BYTES_PER_MS = 32; // PCM16 mono, 16 kHz.

export async function validateAssessmentTrial(wav: Blob, referenceText: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  // Match existing envelope/server normalization, not alternative sentences or punctuation.
  if (referenceText.length > 1000 || referenceText.trim() !== ASSESSMENT_TRIAL.referenceText) throw Error('Assessment trial reference required');
  if (wav.type !== 'audio/wav' || wav.size < HEADER_BYTES + 2 || wav.size > HEADER_BYTES + BYTES_PER_MS * ASSESSMENT_TRIAL.maxDurationMs || (wav.size - HEADER_BYTES) % 2) throw Error('Assessment trial audio must be within five seconds');
  const header = new Uint8Array(await wav.slice(0, HEADER_BYTES).arrayBuffer());
  signal.throwIfAborted();
  if (header.length !== HEADER_BYTES) throw Error('Assessment trial WAV header required');
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const tag = (at: number, value: string) => [...value].every((character, index) => header[at + index] === character.charCodeAt(0));
  if (!tag(0, 'RIFF') || view.getUint32(4, true) !== wav.size - 8 || !tag(8, 'WAVE') || !tag(12, 'fmt ') || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16000 || view.getUint32(28, true) !== 32000 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || !tag(36, 'data') || view.getUint32(40, true) !== wav.size - HEADER_BYTES) throw Error('Assessment trial requires canonical PCM16 mono 16kHz WAV');
}
