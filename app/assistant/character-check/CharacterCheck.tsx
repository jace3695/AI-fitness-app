'use client';
import { useCallback, useMemo, useState } from 'react';
import FreeAdvicePanel from '@/components/FreeAdvicePanel';
import ReplyCharacterPanel from '@/components/yeoni/ReplyCharacterPanel';
import { savedReplyClips } from '@/lib/yeoni/reply-samples';
import { adviceSpokenText, type ReplyPlan } from '@/lib/yeoni/reply-plan';
import type { FreeAdvice } from '@/lib/free-advice';
import type { FreeAdviceContext } from '@/lib/free-advice-context';
export default function CharacterCheck({ audio }: { audio: { ko: string; ja: string } }) {
  const clips = useMemo(() => savedReplyClips(audio), [audio]);
  const [incoming, setIncoming] = useState<Readonly<{ value: unknown }> | null>(null);
  const completed = useCallback(async (advice: FreeAdvice, _source: FreeAdviceContext['recordSource'], performance?: ReplyPlan) => {
    if (!performance) throw new Error('캐릭터 연결이 포함된 새 Preview를 열어 주세요.');
    setIncoming({ value: { reply: adviceSpokenText(advice), performance } });
  }, []);
  const busy = useCallback((value: boolean) => { if (value) setIncoming(null); }, []);
  return <>
    <ReplyCharacterPanel clips={clips} incoming={incoming} />
    <FreeAdvicePanel scope="assistant" initialQuestion="이 기록을 바탕으로 오늘 할 수 있는 작은 행동을 알려줘."
      onComplete={completed} onBusyChange={busy} />
  </>;
}
