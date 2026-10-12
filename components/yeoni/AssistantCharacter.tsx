'use client';

import { useMemo } from 'react';
import { savedReplyClips } from '@/lib/yeoni/reply-samples';
import ReplyCharacterPanel from './ReplyCharacterPanel';

export default function AssistantCharacter({ audio, incoming, busy, alignReplies = false }: {
  audio: { ko: string; ja: string };
  incoming: Readonly<{ value: unknown }> | null;
  busy: boolean; alignReplies?: boolean;
}) {
  const clips = useMemo(() => savedReplyClips(audio), [audio]);
  return <ReplyCharacterPanel clips={clips} incoming={incoming} busy={busy} presentation="assistant" alignReplies={alignReplies} />;
}
