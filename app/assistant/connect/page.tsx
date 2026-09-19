'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/supabase';
import { AREA_LABELS, CHATGPT_REDIRECT, CONNECT_AREAS, type ConnectArea, type ConnectRequest, type Connection } from '@/lib/chatgpt-connection';

export default function ChatgptConnectPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [authorization, setAuthorization] = useState<ConnectRequest | null>(null);
  const [origin, setOrigin] = useState('');
  const [areas, setAreas] = useState<ConnectArea[]>([...CONNECT_AREAS]);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null); const lock = useRef(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await authenticatedFetch(`/api/chatgpt/connection${window.location.search}`, { cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setConnections(data.connections); setAuthorization(data.authorization); setOrigin(data.origin);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '연결 정보를 확인하지 못했습니다.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const decide = async (decision: 'approve' | 'deny' | 'revoke', id?: string) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await authenticatedFetch('/api/chatgpt/connection', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, id, areas, query: window.location.search }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (decision === 'revoke') { setConnections(data.connections); setRevokeId(null); setMessage('연결을 해제했습니다. ChatGPT에서 새로 조회하거나 저장할 수 없습니다.'); }
      else {
        const target = new URL(data.redirect);
        if (`${target.origin}${target.pathname}` !== CHATGPT_REDIRECT) throw new Error('돌아갈 ChatGPT 주소를 확인하지 못했습니다.');
        window.location.assign(target.toString());
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '연결 결과를 확인하지 못했습니다. 다시 확인해 주세요.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const active = connections.filter(item => item.active);
  return <main className="min-h-dvh bg-yeoni-bg px-4 pb-28 pt-6 text-gray-800"><div className="mx-auto max-w-2xl">
    <Link href="/assistant" className="text-sm font-bold text-violet-700">← 연이</Link>
    <h1 className="mt-5 text-2xl font-bold">ChatGPT 연결</h1>
    <p className="mt-2 text-sm leading-6 text-gray-600">ChatGPT에 기록 분석을 부탁하고, 받은 조언을 연이에서 확인해요.</p>
    <Link href="/assistant/advice" className="mt-4 inline-block rounded-xl bg-white px-4 py-3 font-bold text-violet-700">저장한 ChatGPT 조언 보기 →</Link>
    {loading && <p role="status" className="mt-5">연결 정보를 불러오는 중…</p>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    {message && <p role="status" className="mt-4 rounded-xl bg-green-50 p-4 text-green-800">{message}</p>}
    {!loading && authorization && <section aria-label="ChatGPT 연결 승인" className="mt-5 rounded-2xl border border-violet-200 bg-white p-5">
      <h2 className="text-lg font-bold">ChatGPT에 어느 기록을 보여줄까요?</h2>
      <p className="mt-2 text-sm leading-6">선택한 영역의 최근 7일·28일 집계를 보여줍니다. 이름·메모·사진·대화 원문은 공유하지 않아요.</p>
      <fieldset disabled={busy} className="mt-4"><legend className="text-sm font-bold">허용할 기록 영역</legend>
        <div className="mt-2 flex flex-wrap gap-2">{CONNECT_AREAS.map(area => <label key={area} className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 text-sm">
          <input type="checkbox" checked={areas.includes(area)} onChange={event => setAreas(current => event.target.checked ? [...current, area] : current.filter(item => item !== area))} />{AREA_LABELS[area]}
        </label>)}</div>
      </fieldset>
      <p className="mt-4 text-sm font-bold">허용하는 동작</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {authorization.scopes.includes('yeoni:records:read') && <li>선택한 영역의 기록 요약 조회</li>}
        {authorization.scopes.includes('yeoni:advice:read') && <li>선택한 영역에 저장된 조언 조회</li>}
        {authorization.scopes.includes('yeoni:advice:write') && <li>요청한 분석 조언을 연이에 저장</li>}
      </ul>
      <p className="mt-4 text-sm leading-6 text-gray-600">원본 기록을 바꾸거나 음성을 생성하는 권한은 없어요. 연결은 최대 30일 유지되며 이 화면에서 언제든 해제할 수 있습니다. 연이 로그아웃·기록 초기화 후에는 다시 연결해야 할 수 있어요.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !areas.length || loading} onClick={() => void decide('approve')} className="rounded-xl bg-violet-600 px-4 py-3 font-bold text-white disabled:opacity-50">선택한 권한으로 연결</button>
        <button type="button" disabled={busy} onClick={() => void decide('deny')} className="rounded-xl bg-gray-100 px-4 py-3 font-bold disabled:opacity-50">연결 취소</button>
      </div>
    </section>}
    {!loading && !authorization && origin && <section className="mt-5 rounded-2xl bg-white p-5">
      <h2 className="font-bold">ChatGPT에서 연결 시작하기</h2>
      <p className="mt-2 text-sm leading-6">ChatGPT의 플러그인에서 새 연결을 추가할 때 아래 주소를 사용하세요. 연결 기능은 계정 설정에 따라 표시되지 않을 수 있어요.</p>
      <label className="mt-3 block text-sm font-bold" htmlFor="chatgpt-connection-url">연결 주소</label>
      <input id="chatgpt-connection-url" readOnly value={`${origin}/mcp`} className="mt-2 w-full min-w-0 rounded-xl border bg-gray-50 p-3 text-xs" onFocus={event => event.target.select()} />
      <button type="button" onClick={() => void navigator.clipboard.writeText(`${origin}/mcp`).then(() => setMessage('연결 주소를 복사했습니다.')).catch(() => setError('주소를 선택해 직접 복사해 주세요.'))} className="mt-2 rounded-xl bg-violet-50 px-4 py-2 text-sm font-bold text-violet-700">주소 복사</button>
      <p className="mt-3 text-sm leading-6 text-gray-600">연결 후 ChatGPT에서 “최근 7일 운동 기록을 분석하고 조언을 연이에 저장해 줘”라고 요청해 보세요. 이 연결은 별도 유료 AI API를 호출하지 않습니다. ChatGPT 구독 사용 한도는 적용됩니다.</p>
    </section>}
    {!loading && !error && <section className="mt-5 rounded-2xl bg-white p-5">
      <h2 className="font-bold">현재 연결</h2>
      {!active.length && <p className="mt-2 text-sm text-gray-600">현재 활성화된 연결이 없습니다.</p>}
      {active.map(item => <article key={item.id} aria-label="활성 ChatGPT 연결" className="mt-3 rounded-xl border p-4">
        <p className="font-bold">ChatGPT 연결됨</p><p className="mt-1 text-sm">{item.areas.map(area => AREA_LABELS[area]).join(' · ')}</p>
        <p className="mt-1 text-xs text-gray-500">연결 만료: {new Date(item.expires_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
        {revokeId === item.id ? <div className="mt-3"><p className="text-sm">이 연결의 기록 조회와 조언 저장을 중단할까요?</p>
          <button type="button" disabled={busy} onClick={() => void decide('revoke', item.id)} className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">확인하고 연결 해제</button>
          <button type="button" disabled={busy} onClick={() => setRevokeId(null)} className="ml-2 px-3 py-2 text-sm">취소</button></div>
          : <button type="button" disabled={busy} onClick={() => setRevokeId(item.id)} className="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold">연결 해제</button>}
      </article>)}
      <p className="mt-3 text-xs leading-5 text-gray-500">연결 해제 후에도 이미 저장한 조언과 ChatGPT 대화는 남습니다. 연이의 기록 초기화는 해당 영역의 저장된 조언도 지웁니다.</p>
    </section>}
    <button type="button" disabled={loading || busy} onClick={() => void load()} className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-bold text-violet-700 disabled:opacity-50">연결 상태 새로고침</button>
  </div></main>;
}
