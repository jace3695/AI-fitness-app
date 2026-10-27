'use client';

import { useMemo } from 'react';
import { savedReplyClips } from '@/lib/yeoni/reply-samples';
import { createRegisteredReplyClipResolver, type ReplyClip } from '@/lib/yeoni/reply-clip-source';
import ReplyCharacterPanel from './ReplyCharacterPanel';

const NO_FIXED_CLIPS: readonly ReplyClip[] = Object.freeze([]);

export default function AssistantCharacter({ audio, incoming, busy }: {
  audio: { ko: string; ja: string };
  incoming: Readonly<{ value: unknown }> | null;
  busy: boolean;
}) {
  // Existing inline samples only. No generation, fetching, or eager audio load.
  const resolveClip = useMemo(() => createRegisteredReplyClipResolver(savedReplyClips(audio)), [audio]);
  return <ReplyCharacterPanel clips={NO_FIXED_CLIPS} resolveClip={resolveClip} incoming={incoming} busy={busy} presentation="assistant" />;
}
