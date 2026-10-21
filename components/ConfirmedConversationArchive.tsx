'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { authenticatedFetch } from '@/lib/supabase';
import { archiveText, historyId, parseArchiveEntry, parseArchiveSnapshot, type ArchiveEntry, type ArchiveKind, type ArchiveSnapshot } from '@/lib/confirmed-conversation-archive';

export default function ConfirmedConversationArchive({ ownerId, kind, candidate, onRestore }: {
  ownerId: string; kind: ArchiveKind; candidate: ArchiveSnapshot | null; onRestore?: (snapshot: ArchiveSnapshot) => void;
}) {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [cursor, setCursor] = useState<{ before: string; beforeId: string } | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [ack, setAck] = useState(false);
  const [notice, setNotice] = useState(''), [deleting, setDeleting] = useState<string | null>(null), [invalid, setInvalid] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const epoch = useRef(0), locked = useRef(false), alive = useRef(true), controller = useRef<AbortController | null>(null);
  const requestKey = useRef<{ signature: string; id: string } | null>(null);
  const signature = JSON.stringify(candidate);
  useEffect(() => {
    epoch.current++; controller.current?.abort(); locked.current = false;
    requestKey.current = null; setAck(false); setPreviewOpen(false); setBusy(false); setNotice('');
  }, [signature]);
  useEffect(() => {
    alive.current = true;
    const stopRequests = () => { alive.current = false; epoch.current++; controller.current?.abort(); };
    const invalidate = () => {
      stopRequests(); locked.current = false;
      requestKey.current = null; setEntries([]); setCursor(null); setLoaded(false); setBusy(false); setAck(false); setDeleting(null); setInvalid(true); setNotice('계정 상태가 바뀌었어요. 화면을 다시 열어 주세요.');
    };
    const sub = supabase?.auth.onAuthStateChange((_event, session) => { if (session?.user.id !== ownerId) invalidate(); }).data.subscription;
    const storage = (e: StorageEvent) => { if (e.key === null || ['fitness-cloud-sync-user','fitness-cloud-sync-epoch','language-cloud-sync-user'].includes(e.key)) invalidate(); };
    window.addEventListener('yeoni-cloud-session-changed', invalidate); window.addEventListener('storage', storage); window.addEventListener('pagehide', invalidate);
    return () => { stopRequests(); sub?.unsubscribe(); window.removeEventListener('yeoni-cloud-session-changed', invalidate); window.removeEventListener('storage', storage); window.removeEventListener('pagehide', invalidate); };
  }, [ownerId]);
  async function run(action: 'load' | 'more' | 'save' | 'delete', id?: string) {
    if (!alive.current || invalid || locked.current || !supabase || action === 'save' && (!candidate || candidate.kind !== kind || !ack)) return;
    const ticket = ++epoch.current, abort = new AbortController(); controller.current = abort;
    locked.current = true; setBusy(true); setNotice('');
    const timer = window.setTimeout(() => {
      if (ticket !== epoch.current) return;
      epoch.current++; abort.abort(); locked.current = false; setBusy(false);
      setNotice('요청 시간이 초과됐어요. 결과가 불확실하면 같은 내용으로 재시도하거나 보관본을 불러와 확인해 주세요.');
    }, 15000);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (ticket !== epoch.current || !alive.current) return;
      if (error || data.user?.id !== ownerId) throw Error('계정을 확인하지 못했어요. 화면을 다시 열어 주세요.');
      const query = new URLSearchParams({ kind });
      if (action === 'more' && cursor) { query.set('before', cursor.before); query.set('beforeId', cursor.beforeId); }
      if (action === 'delete' && id) query.set('id', id);
      const headers = { 'X-Expected-Owner': ownerId, 'Content-Type': 'application/json' };
      let init: RequestInit = { headers, signal: abort.signal };
      let expectedId: string | undefined;
      if (action === 'save') {
        if (requestKey.current?.signature !== signature) requestKey.current = { signature, id: crypto.randomUUID() };
        expectedId = requestKey.current.id;
        init = { ...init, method: 'POST', body: JSON.stringify({ id: expectedId, acknowledged: true, snapshot: candidate }) };
      } else if (action === 'delete') init.method = 'DELETE';
      if (abort.signal.aborted) return;
      const response = await authenticatedFetch('/api/confirmed-conversation-archive?' + query, init);
      const result = await response.json();
      if (ticket !== epoch.current || !alive.current) return;
      if (!response.ok) throw Error(result.error || '계정 보관을 완료하지 못했어요. 화면의 기록은 유지됩니다.');
      if (action === 'save') {
        const entry = parseArchiveEntry(result.entry), expected = parseArchiveSnapshot(candidate);
        if (!entry || entry.id !== expectedId || JSON.stringify(entry.snapshot) !== JSON.stringify(expected)) throw Error('저장 결과를 확인하지 못했어요. 같은 내용으로 다시 확인해 주세요.');
        setEntries(items => [entry, ...items.filter(x => x.id !== entry.id)]); setNotice('확인한 내용을 계정 보관본으로 저장했어요.');
      } else if (action === 'delete') {
        if (result.deleted !== true) throw Error('삭제 결과를 확인하지 못했어요. 다시 불러와 확인해 주세요.');
        setEntries(items => items.filter(x => x.id !== id)); setDeleting(null); setNotice('선택한 보관본의 내용을 삭제했어요. 원본 탭 기록·측정값은 유지됩니다.');
      } else {
        if (!Array.isArray(result.entries)) throw Error('보관본 응답 형식을 확인하지 못했어요.');
        const rows = result.entries.map(parseArchiveEntry) as (ArchiveEntry | null)[];
        if (rows.some(x => !x || x.snapshot.kind !== kind)) throw Error('보관본 종류를 확인하지 못했어요.');
        const next = result.nextCursor;
        if (next !== null && (!next || !historyId(next.beforeId) || typeof next.before !== 'string' || !Number.isFinite(Date.parse(next.before)) || new Date(next.before).toISOString() !== next.before)) throw Error('다음 조회 위치를 확인하지 못했어요.');
        const valid = rows as ArchiveEntry[];
        setEntries(items => action === 'more' ? [...items, ...valid.filter(x => !items.some(y => y.id === x.id))] : valid);
        setCursor(next); setLoaded(true);
      }
    } catch (e) { if (ticket === epoch.current && alive.current) setNotice(e instanceof Error ? e.message : '연결을 확인하지 못했어요.'); }
    finally { clearTimeout(timer); if (ticket === epoch.current) { locked.current = false; setBusy(false); } }
  }
  return <section aria-label={kind === 'body-dialogue' ? '체성분 대화 계정 보관' : '일본어 연습 계정 보관'} className="mt-4 rounded-xl border p-3 text-sm">
    <h3 className="font-bold">선택한 내용의 계정 보관본</h3>
    <p>자동 저장하지 않습니다. 아래에서 확인·동의한 내용만 앱 서버로 보냅니다. 외부 AI·음성 서비스로 전송하지 않습니다. 이미지·녹음은 포함하지 않지만 문장에 직접 적은 개인 정보는 포함됩니다.</p>
    <p>보관본은 원본 탭·일반 대화·앱 기록 초기화와 별도로 유지됩니다. 직접 내용 삭제 또는 계정 삭제까지 보관하며 내용 삭제는 앱에서 복구할 수 없습니다. 삭제 후 재저장 방지를 위한 요청 ID·종류·저장/삭제 시각은 계정 삭제까지 남습니다.</p>
    {!invalid && candidate && <details open={previewOpen} onToggle={e => setPreviewOpen(e.currentTarget.open)}><summary className="min-h-11 py-3">계정에 보낼 내용 확인</summary>{previewOpen && <pre className="whitespace-pre-wrap break-words">{archiveText(candidate)}</pre>}</details>}
    <label className="flex gap-2 py-2"><input type="checkbox" checked={ack} disabled={!candidate || busy || invalid} onChange={e => setAck(e.target.checked)} />선택한 내용과 보관·삭제 방식에 동의합니다.</label>
    <button type="button" className="min-h-11 px-2" disabled={!candidate || !ack || busy || invalid} onClick={() => void run('save')}>선택 내용 계정 보관</button>
    <button type="button" className="min-h-11 px-2" disabled={busy || invalid} onClick={() => void run('load')}>계정 보관본 불러오기</button>
    {notice && <p role="status">{notice}</p>}{loaded && !entries.length && <p>보관한 내용이 없습니다.</p>}
    {cursor && <button type="button" className="min-h-11 px-2" disabled={busy || invalid} onClick={() => void run('more')}>이전 보관본 더 보기</button>}
    {entries.map(entry => <article key={entry.id} className="my-3 rounded border p-3">
      <p>저장 {new Date(entry.created_at).toLocaleString('ko-KR')} · 저장 당시의 참고 내용</p>
      <details><summary className="min-h-11 py-3">보관 내용 보기</summary><pre className="whitespace-pre-wrap break-words">{archiveText(entry.snapshot)}</pre></details>
      {onRestore && <button type="button" className="min-h-11 px-2" disabled={busy || invalid} onClick={() => { if (alive.current) onRestore(entry.snapshot); }}>이 탭으로 가져오기</button>}
      {deleting === entry.id ? <div><p>이 보관본의 내용을 영구 삭제할까요? 원본은 유지되며 삭제한 내용은 복구할 수 없습니다.</p><button type="button" className="min-h-11 px-2" disabled={busy} onClick={() => void run('delete', entry.id)}>내용 삭제 확인</button><button type="button" className="min-h-11 px-2" disabled={busy} onClick={() => setDeleting(null)}>삭제 취소</button></div> : <button type="button" className="min-h-11 px-2" disabled={busy || invalid} onClick={() => setDeleting(entry.id)}>보관 내용 삭제</button>}
    </article>)}
  </section>;
}
