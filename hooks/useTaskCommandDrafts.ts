'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { COMMAND_DRAFT_KEY, readCommandDrafts, type CommandDraft } from '@/lib/assistant-command-drafts';
import type { AssistantCommandProposal } from '@/lib/assistant-command-drafts';

export function useTaskCommandDrafts() {
  const [drafts, setDrafts] = useState<CommandDraft[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const owner = useRef<string | null>(null);
  const current = useRef<CommandDraft[]>([]);
  useEffect(() => {
    const { data } = supabase?.auth.onAuthStateChange((event, session) => {
      const nextOwner = session?.user.id ?? null;
      if (nextOwner === owner.current && nextOwner && event !== 'INITIAL_SESSION') return;
      owner.current = nextOwner;
      setOwnerId(nextOwner);
      try {
        const restored = nextOwner ? readCommandDrafts(sessionStorage.getItem(COMMAND_DRAFT_KEY), nextOwner) : [];
        if (!nextOwner) sessionStorage.removeItem(COMMAND_DRAFT_KEY);
        current.current = restored; setDrafts(restored); setError('');
      } catch {
        current.current = []; setDrafts([]);
        setError('확인 대기 내용을 복구하지 못했습니다. 새 명령을 보내기 전에 실행 이력에서 저장 여부를 확인해 주세요.');
      }
      setReady(true);
    }) ?? { data: null };
    return () => data?.subscription.unsubscribe();
  }, []);

  const change = useCallback(async (update: (items: CommandDraft[]) => CommandDraft[], keepDisplayed = false, expectedOwner = owner.current) => {
    const session = await supabase?.auth.getSession();
    if (!expectedOwner || session?.data.session?.user.id !== expectedOwner || owner.current !== expectedOwner) {
      throw new Error('로그인 계정이 변경됐습니다. 화면을 다시 열어 주세요.');
    }
    const next = update(current.current);
    try { sessionStorage.setItem(COMMAND_DRAFT_KEY, JSON.stringify({ ownerId: expectedOwner, drafts: next })); }
    catch { throw new Error('이 탭에 확인 내용을 보관하지 못했습니다. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.'); }
    current.current = next; if (!keepDisplayed) setDrafts(next); setError('');
  }, []);
  const add = useCallback((proposal: AssistantCommandProposal, requestedOwner: string) => change(items => {
    if (items.some(item => item.proposal.requestId === proposal.requestId)) return items;
    if (items.length >= 20) throw new Error('확인 대기 명령이 20개입니다. 기존 명령을 확인하거나 닫은 뒤 다시 입력해 주세요.');
    return [...items, { proposal, attempted: false }];
  }, false, requestedOwner), [change]);
  const markAttempted = useCallback((id: string) => change(items => items.map(item => item.proposal.requestId === id ? { ...item, attempted: true } : item)), [change]);
  const remove = useCallback((id: string) => change(items => items.filter(item => item.proposal.requestId !== id), true), [change]);
  return { drafts, ownerId, ready, error, add, markAttempted, remove };
}
