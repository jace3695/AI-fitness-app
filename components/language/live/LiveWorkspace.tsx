'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/app/lib/supabase';
import { createLanguageLiveRepository } from '@/app/data/languageLiveRepository';
import { parseLiveReport } from '@/lib/language-live/report-parser';
import { normalizeLiveReportMetadata, validateLiveReport } from '@/lib/language-live/validation';
import { LanguageLiveError, LIVE_REPORT_MAX_LENGTH, type LiveErrorCode, type LiveFieldKey, type LiveFieldValue, type LiveLesson } from '@/lib/language-live/types';
import { draftKey, draftPrefix, forkLiveDraft, liveDraftSaveInput, LiveRequestEpoch, persistLiveDraft, readLiveDrafts, removeLiveDraft, type LiveEditorDraft } from '@/app/language/live/draft-state';
import ReportFields, { ReportSource } from './ReportFields';
import LiveLearningWorkspace from './LiveLearningWorkspace';

const PAGE_SIZE = 20;
const operationLabels = { create: '처음 등록', edit: '내용 수정', delete: '휴지통 이동', restore: '이전 내용 복원' };
const dateTime = (value: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value));
type Notice = { code?: LiveErrorCode; text: string };
type Mutation = { operation: 'delete' | 'restore'; lesson: LiveLesson; restoreRevision?: number; requestId: string; attempted: boolean };
const errorNotice = (error: unknown): Notice => error instanceof LanguageLiveError
  ? { code: error.code, text: error.message }
  : { code: 'storage', text: '연결을 확인하지 못했어요. 입력한 내용은 유지됩니다. 잠시 뒤 다시 확인해 주세요.' };

/** Auth changes hide the old owner before any new reads or draft restoration. */
export default function LiveWorkspace() {
  const [owner, setOwner] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const client = supabase;
    if (!client) { setAuthError(true); return; }
    let alive = true;
    let version = 0;
    let confirmedOwner: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const confirmOwner = async (epoch: number) => {
      try {
        const { data, error } = await client.auth.getUser();
        if (!alive || epoch !== version) return;
        if (error || !data.user) { setAuthError(true); setOwner(null); return; }
        confirmedOwner = data.user.id;
        setOwner(data.user.id);
        setAuthError(false);
      } catch { if (alive && epoch === version) { setOwner(null); setAuthError(true); } }
    };
    void confirmOwner(version);
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (confirmedOwner && session?.user.id === confirmedOwner && event !== 'SIGNED_OUT') return;
      version += 1;
      confirmedOwner = null;
      setOwner(null);
      clearTimeout(timer);
      if (!session?.user) { setAuthError(true); return; }
      const epoch = version;
      timer = setTimeout(() => { void confirmOwner(epoch); }, 0);
    });
    return () => { alive = false; version += 1; clearTimeout(timer); data.subscription.unsubscribe(); };
  }, [attempt]);
  if (!owner || !supabase) return <section className="live-workspace"><h1>AI Live 학습 기록</h1><p role={authError ? 'alert' : 'status'}>{authError ? '로그인 정보를 확인하지 못했어요. 다시 확인해 주세요.' : '내 학습 기록을 안전하게 여는 중…'}</p>{authError ? <button type="button" onClick={() => { setAuthError(false); setAttempt(value => value + 1); }}>로그인 다시 확인</button> : null}</section>;
  return <OwnerWorkspace key={owner} owner={owner} client={supabase} />;
}

function OwnerWorkspace({ owner, client }: { owner: string; client: SupabaseClient }) {
  const repository = useMemo(() => createLanguageLiveRepository(client, owner), [client, owner]);
  const alive = useRef(true);
  const listEpoch = useRef(new LiveRequestEpoch());
  const detailEpoch = useRef(new LiveRequestEpoch());
  const mutationEpoch = useRef(new LiveRequestEpoch());
  const busyRef = useRef(false);
  const baseline = useRef<string | null>(null);
  const editorRef = useRef<LiveEditorDraft | null>(null);
  const [view, setView] = useState<'import' | 'history' | 'detail' | 'learning'>('import');
  const [learningOpened, setLearningOpened] = useState(false);
  const [learningBusy, setLearningBusy] = useState(false);
  const [editor, setEditor] = useState<LiveEditorDraft | null>(null);
  const [recoveredDrafts, setRecoveredDrafts] = useState<LiveEditorDraft[]>([]);
  const [localStatus, setLocalStatus] = useState('');
  const [localError, setLocalError] = useState('');
  const [storageChanged, setStorageChanged] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [persistence, setPersistence] = useState<'checking' | 'ready' | 'blocked' | 'error'>('checking');
  const [lessons, setLessons] = useState<LiveLesson[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<Notice | null>(null);
  const [page, setPage] = useState(0);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [selected, setSelected] = useState<LiveLesson | null>(null);
  const [history, setHistory] = useState<LiveLesson[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<Notice | null>(null);
  const [snapshot, setSnapshot] = useState<LiveLesson | null>(null);
  const [mutation, setMutation] = useState<Mutation | null>(null);
  const [discardRequested, setDiscardRequested] = useState(false);
  const [duplicateRequested, setDuplicateRequested] = useState(false);

  const restoreDraftList = useCallback(() => {
    try {
      const result = readLiveDrafts(window.localStorage, owner);
      setRecoveredDrafts(result.drafts);
      if (result.unreadable) setLocalError('읽을 수 없는 기기 초안이 있어요. 지우지 않고 그대로 보관했습니다.');
    } catch { setLocalError('이 브라우저에서 기기 초안을 읽을 수 없어요. 원문을 별도로 복사해 보관해 주세요.'); }
  }, [owner]);

  useEffect(() => {
    alive.current = true;
    // Effects are deliberately restartable under Strict Mode.
    listEpoch.current = new LiveRequestEpoch();
    detailEpoch.current = new LiveRequestEpoch();
    mutationEpoch.current = new LiveRequestEpoch();
    busyRef.current = false; setBusy(false);
    restoreDraftList();
    const changed = (event: StorageEvent) => {
      if (!event.key?.startsWith(draftPrefix(owner))) return;
      restoreDraftList();
      const current = editorRef.current;
      if (current && event.key === draftKey(owner, current.draftId) && event.newValue !== baseline.current) {
        setStorageChanged(true);
        setLocalError('다른 탭에서 이 초안이 바뀌었어요. 현재 입력을 별도 초안으로 보관한 후 계속해 주세요.');
      }
    };
    window.addEventListener('storage', changed);
    return () => { alive.current = false; listEpoch.current.close(); detailEpoch.current.close(); mutationEpoch.current.close(); window.removeEventListener('storage', changed); };
  }, [owner, restoreDraftList]);

  useEffect(() => {
    if (!editor?.rawText) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const leave = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.('a[href]');
      if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!window.confirm('서버 저장을 확인하지 않은 초안이 있어요. 이 화면을 나갈까요? 기기 초안 보관 상태를 먼저 확인해 주세요.')) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', leave, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', leave, true); };
  }, [editor?.rawText]);

  const refreshList = useCallback(async () => {
    const gate = listEpoch.current;
    const epoch = gate.start();
    setListLoading(true); setListError(null);
    try {
      const result = await repository.listLessons({ includeDeleted, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      if (!alive.current || !gate.accepts(epoch)) return;
      if (result.some(record => record.user_id !== owner)) throw new LanguageLiveError('account_changed', '계정이 바뀌었어요. 다시 로그인해 주세요.');
      setLessons(result); setPersistence('ready');
    } catch (error) {
      if (!alive.current || !gate.accepts(epoch)) return;
      const next = errorNotice(error); setListError(next); setPersistence(next.code === 'schema_unavailable' ? 'blocked' : 'error');
    } finally { if (alive.current && gate.accepts(epoch)) setListLoading(false); }
  }, [repository, includeDeleted, page, owner]);
  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && !busyRef.current) void refreshList(); };
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [refreshList]);

  const storeEditor = (next: LiveEditorDraft, expected = baseline.current): boolean => {
    editorRef.current = next; setEditor(next); setSuccess('');
    try {
      baseline.current = persistLiveDraft(window.localStorage, next, expected);
      setLocalStatus('기기 초안 보관됨 · 아직 서버 저장 전'); setLocalError(''); setStorageChanged(false);
      restoreDraftList(); return true;
    } catch (error) {
      const changed = error instanceof Error && error.message === 'draft_changed';
      setStorageChanged(changed); setLocalStatus('');
      setLocalError(changed ? '다른 탭의 새 초안을 덮어쓰지 않았어요. 현재 입력을 별도 초안으로 보관해 주세요.' : '기기 초안을 보관하지 못했어요. 이 화면을 닫기 전에 원문을 별도로 복사해 주세요.');
      return false;
    }
  };
  const newDraft = (lesson?: LiveLesson): LiveEditorDraft => ({
    version: 1, ownerId: owner, draftId: crypto.randomUUID(), lessonId: lesson?.lesson_id ?? crypto.randomUUID(),
    requestId: crypto.randomUUID(), expectedRevision: lesson?.revision ?? 0, updatedAt: new Date().toISOString(),
    rawText: lesson?.report.rawText ?? '', report: lesson?.report ?? null, reviewed: false, submitted: false,
    allowDuplicate: false, duplicateReason: '',
  });
  const updateEditor = (next: LiveEditorDraft) => {
    if (busyRef.current || editorRef.current?.submitted) return;
    storeEditor({ ...next, updatedAt: new Date().toISOString(), requestId: crypto.randomUUID() });
    setNotice(null); setDuplicateRequested(false);
  };
  const startNew = () => {
    if (busyRef.current || (editorRef.current && localError)) { setNotice({ text: '현재 입력을 기기 초안으로 보관한 뒤 새 보고서를 시작해 주세요.' }); return; }
    const next = newDraft(); baseline.current = null; storeEditor(next, null); setView('import'); setNotice(null); setDuplicateRequested(false); setDiscardRequested(false);
  };
  const recoverDraft = (draft: LiveEditorDraft) => {
    if (busyRef.current || (editorRef.current && localError)) return;
    try {
      // Re-read the exact key, rather than overwrite with an older list snapshot.
      const encoded = window.localStorage.getItem(draftKey(owner, draft.draftId));
      const current = readLiveDrafts(window.localStorage, owner).drafts.find(value => value.draftId === draft.draftId);
      if (!encoded || !current || JSON.stringify(current) !== encoded) throw new Error('invalid');
      // Never give two tabs a writable reference to the same localStorage key.
      // Keep pending lesson/request identity so a lost response still retries once.
      const recovered = forkLiveDraft(current, crypto.randomUUID(), new Date().toISOString());
      baseline.current = null;
      if (storeEditor(recovered, null)) setLocalStatus('이 탭의 별도 초안으로 불러왔어요. 원래 기기 초안은 보존하며 서버 저장 여부는 별도로 확인해야 해요.');
      setView('import'); setNotice(null); setSuccess(''); setDuplicateRequested(current.allowDuplicate); setDiscardRequested(false);
    } catch { setLocalError('이 초안을 안전하게 열지 못했어요. 저장된 내용은 지우지 않았습니다.'); }
  };
  const makeSeparateDraft = () => {
    const current = editorRef.current; if (!current || busyRef.current) return;
    // Retain mutation identity if a server response was lost; never turn retry into create.
    const next = { ...current, draftId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    baseline.current = null; storeEditor(next, null);
  };
  const parse = () => {
    const current = editorRef.current; if (!current || busyRef.current || current.submitted) return;
    try {
      const report = parseLiveReport(current.rawText);
      updateEditor({ ...current, report, reviewed: false });
    } catch (error) { setNotice(errorNotice(error)); }
  };
  const editField = (key: LiveFieldKey, value: LiveFieldValue) => {
    const current = editorRef.current; if (!current?.report) return;
    updateEditor({ ...current, reviewed: false, report: normalizeLiveReportMetadata({ ...current.report, fields: { ...current.report.fields, [key]: value } }) });
  };

  const openLesson = async (id: string) => {
    const gate = detailEpoch.current;
    const epoch = gate.start();
    setView('detail'); setDetailLoading(true); setDetailError(null); setSelected(null); setHistory([]); setSnapshot(null); setMutation(null); setNotice(null); setDiscardRequested(false);
    try {
      const [lesson, revisions] = await Promise.all([repository.getLesson(id), repository.getHistory(id)]);
      if (!alive.current || !gate.accepts(epoch)) return;
      if (!lesson) { setDetailError({ text: '이 수업을 찾지 못했어요. 목록을 새로 확인해 주세요.' }); return; }
      if (lesson.user_id !== owner || revisions.some(record => record.user_id !== owner)) throw new LanguageLiveError('account_changed', '계정이 바뀌었어요. 다시 로그인해 주세요.');
      if (revisions[0]?.revision !== lesson.revision || revisions[0]?.request_id !== lesson.request_id) throw new LanguageLiveError('conflict', '조회하는 동안 기록이 바뀌었어요. 최신 기록을 다시 확인해 주세요.');
      setSelected(lesson); setHistory(revisions);
    } catch (error) { if (alive.current && gate.accepts(epoch)) setDetailError(errorNotice(error)); }
    finally { if (alive.current && gate.accepts(epoch)) setDetailLoading(false); }
  };
  const beginEdit = () => {
    if (!selected || busyRef.current || (editorRef.current && localError)) return;
    const next = newDraft(selected); baseline.current = null; storeEditor(next, null); setView('import'); setNotice(null); setDuplicateRequested(false); setDiscardRequested(false);
  };
  const verified = (record: LiveLesson) => {
    setSelected(record); setSnapshot(null); setView('detail'); setDetailError(null); setMutation(null); setNotice(null);
    setHistory(previous => [record, ...previous.filter(item => item.lesson_id === record.lesson_id && item.revision !== record.revision)]);
    setSuccess(`서버 저장 확인 · ${operationLabels[record.operation]} · 버전 ${record.revision}. 저장한 내용을 다시 조회해 확인했어요.`);
    setPersistence('ready'); void refreshList();
  };
  const save = async () => {
    const current = editorRef.current;
    if (!current?.report || !current.reviewed || busyRef.current || persistence !== 'ready' || storageChanged) return;
    const errors = validateLiveReport(current.report);
    if (errors.length) { setNotice({ code: 'validation', text: errors.join(' ') }); return; }
    if (current.allowDuplicate && current.duplicateReason.trim().length < 3) { setNotice({ text: '별도 수업인 이유를 3자 이상 적어 주세요.' }); return; }
    const pending = { ...current, submitted: true };
    if (!storeEditor(pending)) return;
    busyRef.current = true; setBusy(true); setNotice(null); setSuccess('');
    const gate = mutationEpoch.current; const epoch = gate.start();
    try {
      const record = await repository.saveLesson(liveDraftSaveInput(pending));
      if (!gate.accepts(epoch) || record.user_id !== owner) return;
      try { removeLiveDraft(window.localStorage, pending, baseline.current); } catch { /* The verified server record remains; local draft is never falsely marked deleted. */ }
      baseline.current = null; editorRef.current = null; setEditor(null); setLocalStatus(''); restoreDraftList(); verified(record);
      void openLesson(record.lesson_id);
    } catch (error) {
      if (!gate.accepts(epoch)) return;
      const next = errorNotice(error); setNotice(next);
      if (next.code === 'schema_unavailable') setPersistence('blocked');
      if (next.code === 'duplicate' || next.code === 'validation' || next.code === 'conflict' || next.code === 'schema_unavailable') {
        storeEditor({ ...pending, submitted: false });
      }
    } finally { if (gate.accepts(epoch)) { busyRef.current = false; setBusy(false); } }
  };
  const runMutation = async () => {
    if (!mutation || busyRef.current) return;
    const pending = { ...mutation, attempted: true }; setMutation(pending); busyRef.current = true; setBusy(true); setNotice(null);
    const gate = mutationEpoch.current; const epoch = gate.start();
    try {
      const input = { requestId: pending.requestId, lessonId: pending.lesson.lesson_id, expectedRevision: pending.lesson.revision };
      const record = pending.operation === 'delete' ? await repository.deleteLesson(input)
        : await repository.restoreLesson({ ...input, restoreRevision: pending.restoreRevision! });
      if (!gate.accepts(epoch) || record.user_id !== owner) return;
      verified(record); void openLesson(record.lesson_id);
    } catch (error) { if (gate.accepts(epoch)) { const next = errorNotice(error); setNotice(next); if (next.code === 'schema_unavailable') setPersistence('blocked'); } }
    finally { if (gate.accepts(epoch)) { busyRef.current = false; setBusy(false); } }
  };
  const discardDraft = () => {
    const current = editorRef.current; if (!current || current.submitted || busyRef.current) return;
    try {
      if (!removeLiveDraft(window.localStorage, current, baseline.current)) { setLocalError('다른 탭에서 초안이 바뀌어 지우지 않았어요. 새 내용을 먼저 확인해 주세요.'); return; }
      baseline.current = null; editorRef.current = null; setEditor(null); setDiscardRequested(false); setLocalStatus(''); setLocalError(''); restoreDraftList();
    } catch { setLocalError('기기 초안을 지우지 못했어요. 내용을 보관한 상태로 다시 시도해 주세요.'); }
  };
  const report = editor?.report;
  const validationErrors = report ? validateLiveReport(report) : [];
  const displayLesson = snapshot ?? selected;

  return <section className="live-workspace" aria-labelledby="live-title">
    <Link className="live-back" href="/language">← 일본어 학습</Link>
    <header><span className="live-eyebrow">CHATGPT LIVE · 직접 가져오기</span><h1 id="live-title">AI Live 학습 기록</h1>
      <p className="live-intro">수업이 끝나면 보고서를 복사해 붙여넣으세요. 원문과 확인한 내용을 함께 보관해요.</p>
      <p className="live-hint">보고서의 근거를 직접 확인하면 영역별 학습 상태와 복습일을 관리할 수 있어요. 기존 일본어 학습 완료 기록은 바뀌지 않아요.</p>
    </header>
    {persistence === 'blocked' ? <div className="live-notice live-notice-warning" role="alert"><strong>서버 기록 저장을 아직 사용할 수 없어요.</strong><p>Live 전용 저장소가 준비되지 않아 기록 조회·저장을 중단했어요. 빈 기록으로 판단하지 않습니다. 붙여넣기와 기기 초안 보관은 할 수 있어요.</p><button type="button" onClick={() => void refreshList()} disabled={listLoading}>저장소 다시 확인</button></div> : null}
    <nav className="live-tabs" aria-label="AI Live 메뉴">
      <button type="button" aria-current={view === 'import' ? 'page' : undefined} disabled={busy || learningBusy} onClick={() => { detailEpoch.current.invalidate(); setView('import'); setNotice(null); setMutation(null); setDiscardRequested(false); }}>보고서 가져오기</button>
      <button type="button" aria-current={view === 'history' || view === 'detail' ? 'page' : undefined} disabled={busy || learningBusy} onClick={() => { detailEpoch.current.invalidate(); setView('history'); setNotice(null); setMutation(null); setDiscardRequested(false); void refreshList(); }}>학습 이력</button>
      <button type="button" aria-current={view === 'learning' ? 'page' : undefined} disabled={busy || learningBusy} onClick={() => { detailEpoch.current.invalidate(); setLearningOpened(true); setView('learning'); setNotice(null); setMutation(null); }}>복습·학습 상태</button>
    </nav>
    <div className="live-status" aria-live="polite">{busy ? <p role="status">저장한 내용을 서버에서 다시 확인하는 중…</p> : null}{success ? <p className="live-notice live-notice-success" role="status">{success}</p> : null}</div>
    {notice ? <div className="live-notice live-notice-error" role="alert">{notice.text}{notice.code === 'conflict' && editor ? <div className="live-actions"><button type="button" onClick={() => void openLesson(editor.lessonId)}>서버의 최신 기록 보기</button></div> : null}</div> : null}

    {learningOpened ? <LiveLearningWorkspace owner={owner} client={client} active={view === 'learning'} onBusyChange={setLearningBusy} /> : null}

    {view === 'import' ? <>
      {recoveredDrafts.length ? <details className="live-source"><summary>이 계정의 기기 초안 {recoveredDrafts.length}개</summary><div className="live-card live-draft-list"><p className="live-hint">이 브라우저의 원문 보관본이에요. 불러오면 이 탭의 별도 초안이 만들어져요. 서버 저장을 마친 예전 보관본이 남아 있을 수 있어요.</p>{recoveredDrafts.map(draft => <button type="button" key={draft.draftId} disabled={busy || Boolean(localError && editor)} onClick={() => recoverDraft(draft)}>{draft.expectedRevision ? '수정 초안' : '새 수업 초안'} · {dateTime(draft.updatedAt)}{draft.submitted ? ' · 저장 결과 확인 필요' : ''}</button>)}</div></details> : null}
      <section className="live-card" aria-labelledby="paste-title"><h2 id="paste-title">1. 보고서 붙여넣기</h2><p className="live-hint">「연이 AI 일본어 학습 기록 v1」 또는 v1.1을 넣어 주세요. 개인 정보나 회사 기밀은 먼저 확인해 주세요.</p>
        <label htmlFor="live-raw">수업 보고서 원문</label><textarea id="live-raw" className="live-paste" value={editor?.rawText ?? ''} disabled={busy || Boolean(editor?.submitted) || Boolean(editor?.expectedRevision)} placeholder={'[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜:\n수업 주제:\n현재 학습 단계:'}
          onChange={(event) => { const current = editorRef.current ?? newDraft(); updateEditor({ ...current, rawText: event.target.value, report: null, reviewed: false }); }} />
        <p className="live-hint">{(editor?.rawText.length ?? 0).toLocaleString('ko-KR')} / {LIVE_REPORT_MAX_LENGTH.toLocaleString('ko-KR')}자 · 원문은 자동으로 잘라내지 않아요.</p>
        {editor?.expectedRevision ? <p className="live-hint">수정 중: 버전 {editor.expectedRevision}에 새 이력을 추가해요. 처음 붙여넣은 원문은 보존하고 아래 항목을 수정해 주세요.</p> : null}
        {localStatus ? <p className="live-hint" role="status">{localStatus}</p> : null}
        {localError ? <div className="live-notice live-notice-error" role="alert">{localError}{editor ? <div className="live-actions"><button type="button" disabled={busy} onClick={makeSeparateDraft}>현재 입력을 별도 초안으로 보관</button></div> : null}</div> : null}
        <div className="live-actions"><button type="button" className="live-primary" disabled={busy || !editor?.rawText.trim() || Boolean(editor.submitted) || editor.rawText.length > LIVE_REPORT_MAX_LENGTH || Boolean(editor.expectedRevision)} onClick={parse}>25개 항목 분석하기</button><button type="button" disabled={busy || Boolean(editor && localError)} onClick={startNew}>새 보고서 시작</button>{editor && !editor.submitted ? <button type="button" disabled={busy} onClick={() => setDiscardRequested(true)}>이 기기 초안 지우기</button> : null}</div>
        {editor && discardRequested ? <div className="live-confirm"><p>이 기기의 현재 초안만 지울까요? 서버에 저장한 수업은 바뀌지 않아요.</p><div className="live-actions"><button type="button" className="live-danger" onClick={discardDraft}>초안 지우기 확인</button><button type="button" onClick={() => setDiscardRequested(false)}>취소</button></div></div> : null}
      </section>
      {report && editor ? <section className="live-card" aria-labelledby="preview-title"><h2 id="preview-title">2. 내용 확인하고 수정하기</h2>
        <div className="live-meta"><span className="live-badge">보고서 {report.reportVersion === 'unknown' ? '버전 미확인' : report.reportVersion}</span><span className="live-badge">25개 표준 항목</span><span className="live-badge">학습 시간대: {report.lessonTimezone}</span></div>
        <p className="live-hint">접힌 항목도 열어 확인해 주세요. 미확인, 미학습, 해당 없음은 서로 달라요. AI가 적은 평가를 객관적인 점수나 숙달로 바꾸지 않아요.</p>
        {report.lessonDate === null ? <p className="live-notice live-notice-warning">학습 날짜가 미확인이에요. 오늘 날짜를 임의로 넣지 않아요.</p> : null}
        <ReportSource report={report} /><ReportFields report={report} disabled={busy || editor.submitted} onChange={editField} />
        {validationErrors.length ? <div className="live-notice live-notice-error" role="alert"><ul>{validationErrors.map(message => <li key={message}>{message}</li>)}</ul></div> : null}
        <label className="live-checkbox"><input type="checkbox" checked={editor.reviewed} disabled={busy || editor.submitted} onChange={(event) => updateEditor({ ...editor, reviewed: event.target.checked })} /><span>분석한 내용과 미확인 항목을 확인했어요. 이 내용으로 저장할게요.</span></label>
        {notice?.code === 'duplicate' || duplicateRequested ? <div className="live-confirm"><strong>같은 보고서가 이미 있어요.</strong><p>먼저 학습 이력에서 기존 수업을 확인해 주세요. 실제로 다른 수업인 경우만 구분 이유를 남겨 별도로 저장할 수 있어요.</p><label htmlFor="duplicate-reason">별도 수업인 이유</label><input id="duplicate-reason" value={editor.duplicateReason} maxLength={500} disabled={busy || editor.submitted} onChange={(event) => { if (busyRef.current || editorRef.current?.submitted) return; setDuplicateRequested(true); storeEditor({ ...editor, duplicateReason: event.target.value, requestId: crypto.randomUUID(), submitted: false }); }} /><label className="live-checkbox"><input type="checkbox" checked={editor.allowDuplicate} disabled={busy || editor.submitted} onChange={(event) => { if (busyRef.current || editorRef.current?.submitted) return; setDuplicateRequested(true); storeEditor({ ...editor, allowDuplicate: event.target.checked, requestId: crypto.randomUUID(), submitted: false }); }} /><span>중복 입력이 아니라 실제로 다른 수업임을 확인했어요.</span></label></div> : null}
        {editor.submitted ? <p className="live-notice live-notice-warning">저장 결과를 아직 확인하지 못했어요. 입력을 고치지 않고 같은 요청으로 다시 확인하면 중복 등록을 막을 수 있어요.</p> : null}
        <div className="live-actions"><button type="button" className="live-primary" disabled={busy || !editor.reviewed || validationErrors.length > 0 || persistence !== 'ready' || storageChanged || (editor.allowDuplicate && editor.duplicateReason.trim().length < 3)} onClick={() => void save()}>{editor.submitted ? '같은 요청으로 저장 다시 확인' : editor.expectedRevision ? '확인하고 수정 이력 저장' : '확인하고 서버에 저장'}</button>{persistence !== 'ready' ? <button type="button" disabled={listLoading} onClick={() => void refreshList()}>서버 연결 다시 확인</button> : null}</div>
        <p className="live-hint">저장 후 서버에서 다시 조회해 일치한 경우에만 ‘서버 저장 확인’으로 표시해요.</p>
      </section> : null}
    </> : null}

    {view === 'history' ? <section className="live-card" aria-labelledby="history-title"><div className="live-toolbar"><h2 id="history-title">학습 이력</h2><button type="button" disabled={listLoading || busy} onClick={() => void refreshList()}>이력 새로고침</button></div>
      <label className="live-checkbox"><input type="checkbox" checked={includeDeleted} disabled={busy} onChange={(event) => { setPage(0); setIncludeDeleted(event.target.checked); }} /><span>휴지통 기록도 보기</span></label>
      {listLoading ? <p role="status">서버에서 학습 이력을 확인하는 중…</p> : listError ? <p className="live-notice live-notice-error" role="alert">{listError.text} 기록이 없는 상태로 처리하지 않았어요.</p> : lessons.length === 0 ? <p>{page === 0 ? '아직 서버에 저장한 AI Live 수업이 없어요.' : '이 페이지에 더 이상 수업이 없어요.'}</p> : <ul className="live-list">{lessons.map(lesson => <li key={lesson.lesson_id}><div className="live-list-head"><div><span className="live-badge">{lesson.report.lessonDate ?? '날짜 미확인'}</span>{lesson.operation === 'delete' ? <span className="live-badge">휴지통</span> : null}<h3>{lesson.report.topic || '주제 미확인 수업'}</h3><p className="live-hint">{lesson.report.stage || '단계 미확인'} · 버전 {lesson.revision}</p></div><button type="button" onClick={() => void openLesson(lesson.lesson_id)} aria-label={`${lesson.report.topic || '주제 미확인 수업'} 기록 보기`}>기록 보기</button></div></li>)}</ul>}
      <div className="live-actions"><button type="button" disabled={page === 0 || listLoading} onClick={() => setPage(value => value - 1)}>이전 20개</button><span>{page + 1}페이지</span><button type="button" disabled={listLoading || Boolean(listError) || lessons.length < PAGE_SIZE} onClick={() => setPage(value => value + 1)}>다음 20개</button></div>
    </section> : null}

    {view === 'detail' ? <section className="live-card" aria-labelledby="detail-title"><div className="live-toolbar"><h2 id="detail-title">수업 기록</h2><button type="button" disabled={busy} onClick={() => { detailEpoch.current.invalidate(); setView('history'); setMutation(null); }}>목록으로</button></div>
      {detailLoading ? <p role="status">원문과 변경 이력을 확인하는 중…</p> : detailError ? <div className="live-notice live-notice-error" role="alert">{detailError.text}<p>목록에서 수업을 다시 선택해 주세요. 이전 기록은 바뀌지 않았어요.</p></div> : displayLesson && selected ? <>
        <h3>{displayLesson.report.topic || '주제 미확인 수업'}</h3><div className="live-meta"><span className="live-badge">학습일 {displayLesson.report.lessonDate ?? '미확인'}</span><span className="live-badge">{displayLesson.report.reportVersion}</span><span className="live-badge">버전 {displayLesson.revision}</span><span className="live-badge">{operationLabels[displayLesson.operation]}</span></div>
        <p className="live-hint">이 버전 등록: {dateTime(displayLesson.created_at)} (한국 시간) · 학습 시간대: {displayLesson.report.lessonTimezone}</p>
        {displayLesson.duplicate_reason ? <p className="live-notice">별도 수업으로 등록한 이유: {displayLesson.duplicate_reason}</p> : null}
        {snapshot ? <p className="live-notice live-notice-warning">과거 버전 {snapshot.revision}을 보고 있어요. 현재 버전은 {selected.revision}이에요. <button type="button" onClick={() => setSnapshot(null)}>현재 내용 보기</button></p> : null}
        {selected.operation === 'delete' ? <p className="live-notice live-notice-warning">휴지통에 있는 수업이에요. 원문과 변경 이력을 보존하고 있으며 아래 이력에서 복원할 내용을 선택할 수 있어요.</p> : null}
        <ReportSource report={displayLesson.report} /><ReportFields report={displayLesson.report} prefix="live-record" />
        <div className="live-actions">{selected.operation !== 'delete' && !snapshot ? <><button type="button" className="live-primary" disabled={busy || Boolean(editor && localError)} onClick={beginEdit}>이 수업 수정하기</button><button type="button" className="live-danger" disabled={busy} onClick={() => { setNotice(null); setMutation({ operation: 'delete', lesson: selected, requestId: crypto.randomUUID(), attempted: false }); }}>휴지통으로 이동</button></> : null}</div>
        <section className="live-card" aria-label="수정·삭제·복원 이력"><h3>수정·삭제·복원 이력</h3><p className="live-hint">예전 원문을 덮어쓰지 않고 새 버전을 추가해요.</p><ul className="live-list">{history.map(revision => <li key={revision.revision}><strong>버전 {revision.revision} · {operationLabels[revision.operation]}</strong><p className="live-hint">{dateTime(revision.created_at)} (한국 시간){revision.restored_from_revision ? ` · 버전 ${revision.restored_from_revision}에서 복원` : ''}</p><div className="live-actions"><button type="button" disabled={busy} onClick={() => setSnapshot(revision)}>버전 {revision.revision} 보기</button>{revision.operation !== 'delete' && revision.revision !== selected.revision ? <button type="button" disabled={busy} onClick={() => { setNotice(null); setMutation({ operation: 'restore', lesson: selected, restoreRevision: revision.revision, requestId: crypto.randomUUID(), attempted: false }); }}>이 버전으로 복원</button> : null}</div></li>)}</ul></section>
        {mutation ? <div className="live-confirm" role="region" aria-label={mutation.operation === 'delete' ? '휴지통 이동 확인' : '복원 확인'}><h3>{mutation.operation === 'delete' ? '이 수업을 휴지통으로 옮길까요?' : `버전 ${mutation.restoreRevision}의 내용으로 복원할까요?`}</h3><p>{mutation.operation === 'delete' ? '일반 수업 목록에서 제외돼요. 원문과 이전 이력은 남아 다시 복원할 수 있어요.' : '선택한 내용으로 새 버전을 추가해요. 학습 날짜와 이전 이력은 보존돼요.'}</p><div className="live-actions"><button type="button" className="live-primary" disabled={busy || persistence === 'blocked'} onClick={() => void runMutation()}>{mutation.attempted ? '같은 요청으로 다시 확인' : mutation.operation === 'delete' ? '확인하고 휴지통으로 이동' : '확인하고 복원'}</button><button type="button" disabled={busy} onClick={() => { setMutation(null); setNotice(null); }}>닫기</button></div></div> : null}
      </> : null}
    </section> : null}
  </section>;
}
