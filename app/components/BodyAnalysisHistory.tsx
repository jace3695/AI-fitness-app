'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { authenticatedFetch } from '@/lib/supabase';
import { parseBodyAnalysisEntry, type BodyAnalysisEntry, type BodyAnalysisSnapshot } from '@/lib/body-analysis-history';
const endpoint = '/api/fitness/body-analysis-history';
export default function BodyAnalysisHistory({ candidate }: { candidate: { ownerId: string; snapshot: BodyAnalysisSnapshot } | null }) {
  const [entries, setEntries] = useState<BodyAnalysisEntry[]>([]);
  const [loaded, setLoaded] = useState(false), [cursor, setCursor] = useState<{ before: string; beforeId: string } | null>(null);
  const [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const epoch = useRef(0), locked = useRef(false), owner = useRef<string | null>(null);
  const save = useRef<{ key: string; id: string } | null>(null);
  const signature = candidate ? JSON.stringify(candidate) : '';
  useEffect(() => { setAck(false); setPreviewOpen(false); setNotice(''); save.current = null; }, [signature]);
  useEffect(() => {
    const invalidateRequests = () => { epoch.current++; controller.current?.abort(); };
    const clear = () => { invalidateRequests(); locked.current = false; save.current = null; setEntries([]); setLoaded(false); setCursor(null); setAck(false); setDeleting(null); setBusy(false); setNotice(''); };
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (next !== owner.current) clear();
      owner.current = next;
    }).data.subscription;
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === 'fitness-cloud-sync-user' || event.key === 'fitness-cloud-sync-epoch') clear(); };
    window.addEventListener('yeoni-cloud-session-changed', clear); window.addEventListener('storage', storage);
    return () => { invalidateRequests(); subscription?.unsubscribe(); window.removeEventListener('yeoni-cloud-session-changed', clear); window.removeEventListener('storage', storage); };
  }, []);
  async function run(action: 'load' | 'more' | 'save' | 'delete', id?: string) {
    if (locked.current || !supabase || action === 'save' && (!candidate || !ack)) return;
    locked.current = true; setBusy(true); setNotice('');
    const ticket = epoch.current;
    let requestId: string | undefined;
    const abort = new AbortController(); controller.current = abort;
    const timer = window.setTimeout(() => {
      if (ticket !== epoch.current) return;
      epoch.current++; abort.abort(); locked.current = false; setBusy(false);
      setNotice('요청 시간이 초과됐습니다. 저장 결과가 불확실하면 같은 화면에서 다시 시도하거나 이력을 조회해 주세요.');
    }, 15000);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (ticket !== epoch.current) return;
      const currentOwner = data.user?.id;
      if (error || !currentOwner || currentOwner !== owner.current || action === 'save' && currentOwner !== candidate?.ownerId) throw new Error('계정을 다시 확인한 뒤 새로 점검해 주세요.');
      let url = endpoint, init: RequestInit = { headers: { 'X-Expected-Owner': currentOwner } };
      if (action === 'more' && cursor) url += '?' + new URLSearchParams(cursor);
      if (action === 'save' && candidate) {
        if (save.current?.key !== signature) save.current = { key: signature, id: crypto.randomUUID() };
        requestId = save.current.id;
        init = { method: 'POST', headers: { ...init.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: save.current.id, snapshot: candidate.snapshot, acknowledged: true }) };
      } else if (action === 'delete' && id) { url += '?id=' + encodeURIComponent(id); init.method = 'DELETE'; }
      if (abort.signal.aborted) throw new Error('요청 시간이 초과됐습니다. 같은 요청으로 다시 확인해 주세요.');
      const response = await authenticatedFetch(url, { ...init, signal: abort.signal });
      const body = await response.json();
      if (ticket !== epoch.current) return;
      if (!response.ok) throw new Error(body.error || '이력 요청을 완료하지 못했습니다.');
      if (action === 'load' || action === 'more') {
        if (!Array.isArray(body.entries)) throw new Error('이력 응답을 확인하지 못했습니다.');
        const rows = body.entries.map(parseBodyAnalysisEntry);
        if (rows.some((row: BodyAnalysisEntry | null) => !row)) throw new Error('이력 형식을 확인하지 못했습니다.');
        setEntries(items => action === 'more' ? [...items, ...rows.filter((row: BodyAnalysisEntry) => !items.some(item => item.id === row.id))] : rows); setLoaded(true); setCursor(body.nextCursor ?? null);
      } else if (action === 'save') {
        const entry = parseBodyAnalysisEntry(body.entry);
        if (!entry || entry.id !== requestId) throw new Error('저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.');
        setEntries(items => [entry, ...items.filter(item => item.id !== entry.id)]); setNotice('점검 문장을 계정 이력에 저장했습니다.');
      } else { if (body.deleted !== true) throw new Error('삭제 결과를 확인하지 못했습니다. 다시 조회해 주세요.'); setEntries(items => items.filter(item => item.id !== id)); setDeleting(null); setNotice('선택한 분석 이력만 삭제했습니다. 원본 측정·운동 기록은 유지됩니다.'); }
    } catch (error) {
      if (ticket === epoch.current) setNotice(error instanceof Error ? error.message : '연결을 확인하지 못했습니다. 저장 결과가 불확실하면 같은 화면에서 다시 시도해 주세요.');
    } finally { window.clearTimeout(timer); if (ticket === epoch.current) { locked.current = false; setBusy(false); } }
  }
  return <section aria-label="저장한 체성분 분석 이력" className="mt-3 rounded-xl border p-3 text-xs">
    <h4 className="font-bold">계정에 보관하는 분석 이력</h4>
    <p className="mt-2">저장할 때만 아래 점검 문장과 기준일을 앱 서버에 보냅니다. 사진·원본 기록·자유 대화는 보내지 않으며 외부 AI나 음성에 연결하지 않습니다. 운동 기록·일반 대화 초기화와 별도로 보관하며, 아래 이력 삭제 또는 계정 삭제 시 삭제됩니다.</p>
    {candidate && <details className="mt-2" open={previewOpen} onToggle={event => setPreviewOpen(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer py-3">저장할 내용 확인</summary>{previewOpen && <p className="whitespace-pre-wrap break-words">{candidate.snapshot.text}</p>}</details>}
    <label className="mt-2 flex gap-2"><input type="checkbox" disabled={!candidate || busy} checked={ack} onChange={e => setAck(e.target.checked)} />점검 문장을 계정 이력에 저장하는 데 동의합니다.</label>
    <div className="flex flex-wrap gap-2"><button className="min-h-11 px-2 disabled:opacity-50" disabled={!candidate || !ack || busy} onClick={() => void run('save')}>현재 점검 저장</button>
    <button className="min-h-11 px-2 disabled:opacity-50" disabled={busy} onClick={() => void run('load')}>저장 이력 불러오기</button></div>
    {notice && <p role="status" className="my-2">{notice}</p>}
    {loaded && !entries.length && <p>저장한 분석 이력이 없습니다.</p>}
    {cursor && <button className="min-h-11 px-2" disabled={busy} onClick={() => void run('more')}>이전 이력 더 보기</button>}
    {entries.map(entry => <article key={entry.id} className="mt-3 rounded-xl bg-gray-50 p-3">
      <p>점검 기준일 {entry.snapshot.date} · 저장 {new Date(entry.created_at).toLocaleString('ko-KR')}</p>
      <p>저장 당시 로컬 규칙 v{entry.snapshot.version}의 참고 결과입니다. 현재 기록으로 다시 계산한 결과가 아닙니다.</p>
      <details><summary className="min-h-11 cursor-pointer py-3">저장한 분석문 보기</summary><p className="whitespace-pre-wrap break-words">{entry.snapshot.text}</p></details>
      {deleting === entry.id ? <div><p>이 분석 이력만 삭제할까요? 원본 기록은 지우지 않습니다.</p><button className="min-h-11 px-2" disabled={busy} onClick={() => void run('delete', entry.id)}>삭제 확인</button><button className="min-h-11 px-2" disabled={busy} onClick={() => setDeleting(null)}>삭제 취소</button></div>
        : <button className="min-h-11 px-2" disabled={busy} onClick={() => setDeleting(entry.id)}>이력 삭제</button>}
    </article>)}
  </section>;
}
