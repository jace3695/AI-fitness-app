import { parseLipSyncManifest, verifyLipSyncPair, type LipSyncManifest } from './lip-sync.ts';
import { matchesReplyClip, type ReplyPlan } from './reply-plan.ts';

export type ReplyClip = Readonly<{
  manifest: LipSyncManifest;
  load(signal: AbortSignal): Promise<{ bytes: ArrayBuffer; mime: string }>;
}>;
/** Resolve an already obtained audio/alignment artifact, never estimate missing timing. */
export type ReplyClipResolver = (plan: ReplyPlan, signal: AbortSignal) => Promise<ReplyClip | null>;
export type ReplyClipMime = 'audio/mpeg' | 'audio/wav';

/**
 * Snapshot an explicitly supplied catalog, not a text-to-URL lookup or a provider.
 * Registration validates metadata only: it does not run loaders or verify bytes.
 * ReplySession owns the selected loader's cancellation and pair verification.
 */
export function createRegisteredReplyClipResolver(clips: readonly ReplyClip[]): ReplyClipResolver {
  const registered = Object.freeze(clips.map(clip => Object.freeze({
    manifest: parseLipSyncManifest(clip.manifest), load: clip.load.bind(clip),
  })));
  return async (plan, signal) => {
    signal.throwIfAborted();
    return registered.find(clip => matchesReplyClip(plan, clip.manifest)) ?? null;
  };
}

/**
 * Admit an existing artifact without retaining caller-owned buffers or mutable cues.
 * Hashes bind the file and exact text; they do not certify phoneme timing quality.
 * The media adapter still checks decodability/duration before explicit playback.
 */
export async function prepareReplyClip(bytes: ArrayBuffer, input: unknown, mime: ReplyClipMime,
  signal?: AbortSignal): Promise<ReplyClip> {
  signal?.throwIfAborted();
  if (mime !== 'audio/mpeg' && mime !== 'audio/wav') throw new Error('지원하는 음성 파일 형식을 확인해 주세요.');
  // Bound before copying, including an untrusted caller's oversized artifact.
  if (!bytes.byteLength || bytes.byteLength > 8_000_000) throw new Error('음성 파일은 8MB 이하여야 해요.');
  const owned = bytes.slice(0);
  const manifest = await verifyLipSyncPair(owned, input);
  signal?.throwIfAborted();
  if (manifest.alignment === 'synthetic-clock-test') throw new Error('실제 음성과 측정된 음소 타임라인이 필요해요.');
  return Object.freeze({ manifest, async load(loadSignal: AbortSignal) {
    loadSignal.throwIfAborted();
    // Every consumer receives its own buffer; one load cannot corrupt later loads.
    return { bytes: owned.slice(0), mime };
  } });
}
