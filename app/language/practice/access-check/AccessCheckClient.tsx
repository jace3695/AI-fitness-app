'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/app/lib/supabase';
import { createBoundaryCheck, type BoundaryState } from '@/lib/speech-boundary-check';
import { invokeBoundaryProbe, type BoundaryClient } from '@/lib/speech-boundary-transport';
import { verifyBoundaryPage } from '@/lib/speech-boundary-page-gate';

const messages: Record<BoundaryState['outcome'], string> = {
  idle: '버튼을 누르기 전에는 진단 요청을 보내지 않아요.',
  running: '권한을 확인하고 있어요. 음성은 보내지 않아요.',
  'denials-confirmed': 'HTTP 접근 거부와 가짜 준비 요청의 false 응답을 확인했어요. 발음 채점 연결 성공을 뜻하지는 않아요.',
  'unexpected-allow': '예상과 다른 허용 응답이 나와 멈췄어요. 추가 확인이 필요해요.',
  inconclusive: '권한 차단 여부를 판단할 수 없어 멈췄어요.',
  'network-error': '통신을 확인하지 못했어요. 차단 성공으로 처리하지 않았어요.',
  'account-unavailable': '지정된 시험 계정을 확인할 수 없어요. 새 로그인이나 계정 변경은 하지 마세요.',
  'account-changed': '로그인 상태가 바뀌어 멈췄어요. 이전 결과는 지웠어요.',
  cancelled: '확인을 취소했어요. 이미 보낸 조회의 종료를 보장하는 것은 아니에요.',
  timeout: '15초가 지나 멈췄어요. 자동으로 다시 확인하지 않아요.',
};
const labels: Record<string, string> = { keys: '키 설정 표 접근', policy: '시험 설정 표 접근', total: '사용 여부 표 접근', authorized: '내부 확인 함수', payload: '내부 계산 함수', ready: '잘못된 준비 요청' };

/** The injected client is only for isolated tests. The route uses the existing singleton. */
export function AccessCheckPanel({ ownerHash, client }: { ownerHash: string; client: BoundaryClient | null }) {
  const [state, setState] = useState<BoundaryState>({ outcome: 'idle', checks: [] });
  const flow = useRef<ReturnType<typeof createBoundaryCheck> | null>(null);
  useEffect(() => {
    let live = true;
    let observed: string | null | undefined;
    const check = createBoundaryCheck({
      publish: next => { if (live) setState(next); },
      verifyOwner: async signal => {
        if (!client || !/^[a-f0-9]{64}$/.test(ownerHash)) return false;
        signal.throwIfAborted();
        // An older worker may replay this document until its update activates.
        // Require a fresh server gate before any account or database probe.
        if (!await verifyBoundaryPage(ownerHash, signal)) return false;
        const result = await client.auth.getUser(); signal.throwIfAborted();
        const id = result.data.user?.id;
        if (result.error || !id || (observed !== undefined && observed !== id)) return false;
        if (observed === undefined) observed = id;
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)); signal.throwIfAborted();
        return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('') === ownerHash;
      },
      invoke: (probe, signal) => {
        if (!client) throw new Error('Unavailable');
        return invokeBoundaryProbe(client, probe, signal);
      },
    });
    flow.current = check;
    const subscription = client?.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (observed !== undefined && observed !== next) check.invalidate();
      observed = next;
    }).data.subscription;
    const cancel = () => check.cancel();
    const invalidate = () => check.invalidate();
    const storage = (event: StorageEvent) => { if (!event.key || ['fitness-cloud-sync-user', 'fitness-cloud-sync-epoch', 'language-cloud-sync-user'].includes(event.key)) invalidate(); };
    window.addEventListener('pagehide', cancel);
    window.addEventListener('yeoni-cloud-session-changed', invalidate);
    window.addEventListener('storage', storage);
    return () => { live = false; subscription?.unsubscribe(); window.removeEventListener('pagehide', cancel); window.removeEventListener('yeoni-cloud-session-changed', invalidate); window.removeEventListener('storage', storage); check.dispose(); if (flow.current === check) flow.current = null; };
  }, [client, ownerHash]);
  const busy = state.outcome === 'running';
  return <main className="mx-auto max-w-xl space-y-4 px-4 pt-6" style={{ paddingBottom: 'calc(8rem + env(safe-area-inset-bottom))' }}>
    <h1 className="text-xl font-bold">발음 접근 권한 확인</h1>
    <p>지정된 시험 계정에서 잘못된 접근이 막히는지만 확인해요. 발음 기능은 계속 꺼두세요.</p>
    <p>표 3개를 내용 없이 조회하고, 내부 함수의 HTTP 상태와 가짜 준비 요청의 작은 boolean 응답만 확인해요. 음성·키·개인 기록은 읽거나 저장하지 않아요. 시험 횟수를 쓰는 요청도 보내지 않아요.</p>
    <button type="button" className="btn min-h-11" disabled={busy || !client} onClick={() => void flow.current?.start()}>권한 확인하기</button>
    {busy && <button type="button" className="btn min-h-11" onClick={() => flow.current?.cancel()}>확인 취소</button>}
    <p role="status" aria-live="polite">{state.outcome === 'idle' ? '버튼을 누르기 전에는 진단 요청을 보내지 않아요.' : messages[state.outcome]}</p>
    <ul className="space-y-2" aria-label="권한 확인 결과">{state.checks.map(row => <li key={row.id}>{labels[row.id]}: {row.outcome === 'expected-denial' ? '예상대로 차단' : row.outcome === 'unexpected-allow' ? '예상과 다른 허용' : '판단 보류'} · HTTP {row.status}</li>)}</ul>
    <p className="text-sm">결과는 이 화면에서만 보여요. 통신 오류나 취소는 차단 성공이 아니에요. 완료해도 DB 오류코드·키 일치·정상 채점·무료 잔여량을 확인한 것은 아니에요.</p>
    <Link className="inline-flex min-h-11 items-center underline" prefetch={false} href="/language/practice">일본어 연습으로 돌아가기</Link>
  </main>;
}

export default function AccessCheckClient({ ownerHash }: { ownerHash: string }) {
  return <AccessCheckPanel ownerHash={ownerHash} client={supabase as BoundaryClient | null} />;
}
