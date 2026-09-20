'use client';

import { useEffect, useState } from 'react';
import { getDevSyncQaTrace, type SyncQaFault } from '../../lib/syncQaTrace';
import { SUPABASE_URL } from '../../lib/supabase-config';

export default function SyncQaPanel() {
  const [trace, setTrace] = useState<ReturnType<typeof getDevSyncQaTrace>>(null);
  const [revision, setRevision] = useState(0);
  const [method, setMethod] = useState<'GET' | 'PATCH'>('GET');
  const [fault, setFault] = useState<SyncQaFault>('hold-response');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const current = getDevSyncQaTrace(SUPABASE_URL); setTrace(current);
    return current?.subscribe(() => setRevision(value => value + 1));
  }, []);
  if (!trace) return null;
  const state = trace.snapshot();
  const act = (action: () => void) => { try { action(); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : '제어 실패'); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([trace.exportJson()], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `sync-qa-${location.port}-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const stop = () => {
    trace.stop();
    try { sessionStorage.removeItem('yeoni-qa-sync'); } catch { /* In-memory collection is already stopped. */ }
    const url = new URL(location.href); url.searchParams.delete('qa-sync'); url.searchParams.delete('qa-hold');
    history.replaceState(history.state, '', url);
  };
  const saveLocally = async () => {
    try {
      const response = await fetch('/api/sync-qa-capture', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Yeoni-QA': '1' }, body: trace.exportJson(),
      });
      if (!response.ok) throw new Error(`비공개 파일 보관 실패 (${response.status})`);
      const result = await response.json();
      setMessage(`비공개 파일 보관 완료: ${result.file}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '비공개 파일 보관 실패'); }
  };
  return <details className="fixed bottom-2 left-2 right-2 z-[1000] max-h-[70vh] overflow-auto rounded-xl border-2 border-amber-600 bg-white p-3 text-sm shadow-lg">
    <summary className="cursor-pointer font-bold">로컬 동기화 검증 · {state.entries.length}건 · 대기 {state.held.length}건</summary>
    <p className="my-2">개발 화면 전용입니다. 인증 헤더·로그인 요청은 수집하지 않습니다. 내보낸 본문에는 개인 기록이 포함될 수 있으므로 비공개로 보관하세요. 새로고침하면 수집 내용은 사라집니다.</p>
    <p role="status" aria-live="polite" data-revision={revision}>수집 {state.active ? '중' : '종료'} · 처리 중 {state.inFlight}건 · 다음 제어 {state.rule ? `${state.rule.method} ${state.rule.fault}` : '없음'}{state.overflow ? ' · 수집 한도 초과: 불완전한 증거' : ''}</p>
    <div className="my-2 flex flex-wrap gap-2">
      <select aria-label="제어할 요청" value={method} onChange={event => setMethod(event.target.value as 'GET' | 'PATCH')}><option>GET</option><option>PATCH</option></select>
      <select aria-label="오류 또는 지연 종류" value={fault} onChange={event => setFault(event.target.value as SyncQaFault)}>
        <option value="hold-request">전송 전 보류</option><option value="hold-response">서버 응답 후 전달 보류</option><option value="drop-response">서버 응답 후 전달 실패 모사</option><option value="fail-get">해제할 때까지 GET 오류 모사</option>
      </select>
      <button type="button" disabled={!state.active || !!state.rule || !!state.held.length} onClick={() => act(() => trace.arm(method, fault))}>제어 예약</button>
      <button type="button" onClick={() => act(() => trace.release())}>제어 해제</button>
      <button type="button" onClick={download}>비공개 증거 JSON 다운로드</button>
      <button type="button" onClick={() => void saveLocally()}>비공개 증거 로컬 파일 보관</button>
      <button type="button" onClick={() => act(() => trace.clear())}>수집 내용만 비우기</button>
      <button type="button" onClick={() => act(stop)}>수집 종료·내용 폐기</button>
    </div>
    {message && <p role="alert">{message}</p>}
    <ol>{state.entries.map(entry => <li key={entry.id} className="border-t py-1"><details><summary>#{entry.id} {entry.method} · {entry.phase} · HTTP {entry.response?.status ?? '—'}{entry.error ? ` · ${entry.error}` : ''}</summary><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(entry, null, 2)}</pre></details></li>)}</ol>
  </details>;
}
