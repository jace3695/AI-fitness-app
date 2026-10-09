'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLanguageLiveLearningRepository } from '@/app/data/languageLiveLearningRepository';
import { LiveRequestEpoch } from '@/app/language/live/draft-state';
import { blankLearningEvent, createLearningDraft, forkLearningDraft, knownLearningItems, learningDraftKey, learningDraftPrefix, learningSourceProblems, persistLearningDraft, readLearningDrafts, removeLearningDraft, type LiveLearningDraft } from '@/app/language/live/learning-draft';
import { validateLiveLearningInput, LIVE_LEARNING_MAX_EVENTS, matchLiveItem } from '@/lib/language-live/learning-validation';
import type { LiveLearningBatch, LiveLearningEvent, LiveLearningSnapshot } from '@/lib/language-live/learning-types';
import { projectLiveLearning } from '@/lib/language-live/state-reducer';
import { LanguageLiveError, type LiveErrorCode, type LiveLesson } from '@/lib/language-live/types';
import LearningDashboard, { LearningEventSummary } from './LearningDashboard';
import LearningEventEditor from './LearningEventEditor';

const dateTime = (value: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value));
function koreanDate() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
type Notice = { code?: LiveErrorCode; text: string };
const noticeFor = (error: unknown): Notice => error instanceof LanguageLiveError ? { code: error.code, text: error.message }
  : { code: 'storage', text: '복습 기록을 확인하지 못했어요. 입력은 유지됩니다. 연결을 확인하고 다시 시도해 주세요.' };

export default function LiveLearningWorkspace({ owner, client, active, onBusyChange }: {
  owner: string; client: SupabaseClient; active: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const repository = useMemo(() => createLanguageLiveLearningRepository(client, owner), [client, owner]);
  const readEpoch = useRef(new LiveRequestEpoch());
  const saveEpoch = useRef(new LiveRequestEpoch());
  const busyRef = useRef(false);
  const draftRef = useRef<LiveLearningDraft | null>(null);
  const baseline = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<LiveLearningSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<Notice | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<LiveLearningDraft | null>(null);
  const [recovered, setRecovered] = useState<LiveLearningDraft[]>([]);
  const [localError, setLocalError] = useState('');
  const [localStatus, setLocalStatus] = useState('');
  const [storageChanged, setStorageChanged] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [discardRequested, setDiscardRequested] = useState(false);
  const [clearRequested, setClearRequested] = useState(false);
  const [today, setToday] = useState(koreanDate);
  const usable = Boolean(snapshot && !loading && !readError);
  const projection = useMemo(() => snapshot ? projectLiveLearning(snapshot) : null, [snapshot]);
  const currentLesson = snapshot?.lessons.find(lesson => lesson.lesson_id === draft?.input.lessonId);
  const exactSource = currentLesson?.revision === draft?.input.lessonRevision && currentLesson?.operation !== 'delete' ? currentLesson : undefined;
  const currentBatch = projection?.activeBatches.find(batch => batch.lesson_id === draft?.input.lessonId);
  const staleDraft = Boolean(draft && (!exactSource || (currentBatch?.version ?? 0) !== draft.input.expectedVersion));
  const items = useMemo(() => knownLearningItems(snapshot?.batches ?? [], draft), [snapshot, draft]);
  const relearning = useMemo(() => [...(projection?.activeBatches.filter(batch => batch.lesson_id !== draft?.input.lessonId).flatMap(batch => batch.payload.events) ?? []), ...(draft?.input.events ?? [])].filter(event => event.kind === 'relearn'), [projection, draft]);

  const readDrafts = useCallback(() => {
    try {
      const result = readLearningDrafts(window.localStorage, owner);
      setRecovered(result.drafts);
      if (result.unreadable) setLocalError('읽을 수 없는 복습 초안이 있어요. 지우지 않고 보존했어요.');
    } catch { setLocalError('기기 초안을 읽을 수 없어요. 화면의 입력 내용을 별도로 보관해 주세요.'); }
  }, [owner]);
  const refresh = useCallback(async () => {
    const gate = readEpoch.current, epoch = gate.start();
    setLoading(true); setReadError(null);
    try {
      const result = await repository.readLearning();
      if (!gate.accepts(epoch)) return;
      setSnapshot(result); setToday(koreanDate());
    } catch (error) { if (gate.accepts(epoch)) setReadError(noticeFor(error)); }
    finally { if (gate.accepts(epoch)) setLoading(false); }
  }, [repository]);
  useEffect(() => {
    readEpoch.current = new LiveRequestEpoch(); saveEpoch.current = new LiveRequestEpoch();
    busyRef.current = false; setBusy(false); onBusyChange(false); readDrafts();
    const changed = (event: StorageEvent) => {
      if (!event.key?.startsWith(learningDraftPrefix(owner))) return;
      readDrafts();
      const current = draftRef.current;
      if (current && event.key === learningDraftKey(owner, current.draftId) && event.newValue !== baseline.current) {
        setStorageChanged(true); setLocalError('다른 탭에서 초안이 바뀌었어요. 현재 입력을 별도 초안으로 보관해 주세요.');
      }
    };
    window.addEventListener('storage', changed);
    return () => { readEpoch.current.close(); saveEpoch.current.close(); onBusyChange(false); window.removeEventListener('storage', changed); };
  }, [owner, onBusyChange, readDrafts]);
  useEffect(() => {
    if (!active) { readEpoch.current.invalidate(); return; }
    void refresh();
    const retry = () => { if (document.visibilityState === 'visible' && !busyRef.current) void refresh(); };
    window.addEventListener('focus', retry); window.addEventListener('online', retry); document.addEventListener('visibilitychange', retry);
    return () => { readEpoch.current.invalidate(); window.removeEventListener('focus', retry); window.removeEventListener('online', retry); document.removeEventListener('visibilitychange', retry); };
  }, [active, refresh]);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const leave = (event: MouseEvent) => {
      if (!(event.target as Element).closest?.('a[href]') || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!window.confirm('서버 저장을 확인하지 않은 복습 초안이 있어요. 기기 보관 상태를 확인한 뒤 이동할까요?')) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn); document.addEventListener('click', leave, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', leave, true); };
  }, [draft]);

  const store = (next: LiveLearningDraft, expected = baseline.current): boolean => {
    draftRef.current = next; setDraft(next); setSuccess('');
    try {
      baseline.current = persistLearningDraft(window.localStorage, next, expected);
      setLocalStatus('복습 기기 초안 보관됨 · 서버 저장 전'); setLocalError(''); setStorageChanged(false); readDrafts(); return true;
    } catch (error) {
      const changed = error instanceof Error && error.message === 'draft_changed';
      setStorageChanged(changed); setLocalStatus(''); setLocalError(changed ? '다른 탭의 최신 초안을 덮어쓰지 않았어요. 별도 초안으로 보관해 주세요.' : '기기 초안을 보관하지 못했어요. 화면을 닫기 전에 입력을 별도로 복사해 주세요.'); return false;
    }
  };
  const changeDraft = (next: LiveLearningDraft) => {
    if (busyRef.current || draftRef.current?.submitted) return;
    store({ ...next, updatedAt: new Date().toISOString(), input: { ...next.input, requestId: crypto.randomUUID() } }); setNotice(null);
  };
  const begin = (lesson: LiveLesson, source?: LiveLearningBatch) => {
    if (!usable || busyRef.current || (draftRef.current && localError)) return;
    const latest = projection?.activeBatches.find(batch => batch.lesson_id === lesson.lesson_id);
    const next = createLearningDraft(owner, lesson, latest, { draftId: crypto.randomUUID(), requestId: crypto.randomUUID(), now: new Date().toISOString() }, source);
    baseline.current = null; store(next, null); setSelectedId(lesson.lesson_id); setNotice(null); setClearRequested(false); setDiscardRequested(false);
  };
  const recover = (listed: LiveLearningDraft) => {
    if (busyRef.current || (draftRef.current && localError)) return;
    try {
      const encoded = window.localStorage.getItem(learningDraftKey(owner, listed.draftId));
      const saved = readLearningDrafts(window.localStorage, owner).drafts.find(value => value.draftId === listed.draftId);
      if (!saved || JSON.stringify(saved) !== encoded) throw new Error('draft_changed');
      const next = forkLearningDraft(saved, crypto.randomUUID(), new Date().toISOString());
      baseline.current = null;
      if (store(next, null)) setLocalStatus('이 탭의 별도 복습 초안으로 불러왔어요. 원래 초안과 저장 요청은 보존했어요.');
      setSelectedId(next.input.lessonId); setNotice(null); setClearRequested(false); setDiscardRequested(false);
    } catch { setLocalError('초안을 안전하게 열지 못했어요. 저장된 내용은 지우지 않았어요.'); }
  };
  const separate = () => {
    const current = draftRef.current; if (!current || busyRef.current) return;
    baseline.current = null; store(forkLearningDraft(current, crypto.randomUUID(), new Date().toISOString()), null);
  };
  const discard = () => {
    const current = draftRef.current; if (!current || current.submitted || busyRef.current) return;
    try {
      if (!removeLearningDraft(window.localStorage, current, baseline.current)) { setLocalError('초안이 바뀌어 지우지 않았어요. 별도 초안으로 보관한 뒤 다시 확인해 주세요.'); return; }
      draftRef.current = null; baseline.current = null; setDraft(null); setLocalError(''); setLocalStatus(''); setDiscardRequested(false); readDrafts();
    } catch { setLocalError('초안을 지우지 못했어요. 입력은 그대로 보존했어요.'); }
  };
  const updateEntry = (entry: LiveLearningEvent) => {
    const current = draftRef.current; if (!current) return;
    changeDraft({ ...current, entry, entryReviewed: false, reviewed: false });
  };
  const confirmEntry = () => {
    const current = draftRef.current;
    if (!current?.entry || !current.entryReviewed || !exactSource || !usable || learningSourceProblems(current.entry, exactSource).length) return;
    if (matchLiveItem(current.entry.item, items).some(item => item.itemId !== current.entry!.item.itemId)) return;
    const index = current.input.events.findIndex(event => event.eventId === current.entry!.eventId);
    const events = current.input.events.slice();
    if (index < 0) events.push(current.entry); else events[index] = current.entry;
    changeDraft({ ...current, input: { ...current.input, events }, entry: null, entryReviewed: false, reviewed: false });
  };
  const rebaseDraft = () => {
    const current = draftRef.current;
    if (!current || current.submitted || !currentLesson || currentLesson.operation === 'delete' || !usable || busyRef.current || localError) return;
    const next = createLearningDraft(owner, currentLesson, currentBatch, { draftId: crypto.randomUUID(), requestId: crypto.randomUUID(), now: new Date().toISOString() });
    next.input.events = structuredClone(current.input.events); next.entry = current.entry ? structuredClone(current.entry) : null;
    baseline.current = null; store(next, null); setNotice({ text: '현재 보고서 버전으로 복사했어요. 기존 서버의 관찰 목록을 대체하므로 근거와 전체 목록을 다시 확인해 주세요. 관찰 날짜는 바꾸지 않았어요.' });
  };
  const save = async () => {
    const current = draftRef.current;
    if (!current || busyRef.current || !current.reviewed || current.entry || storageChanged || (!current.submitted && (!usable || staleDraft || !exactSource))) return;
    const problems = validateLiveLearningInput(current.input);
    if (!current.submitted && exactSource) for (const event of current.input.events) problems.push(...learningSourceProblems(event, exactSource));
    if (problems.length) { setNotice({ code: 'validation', text: [...new Set(problems)].join(' ') }); return; }
    const pending = { ...current, submitted: true };
    if (!store(pending)) return;
    readEpoch.current.invalidate(); busyRef.current = true; setBusy(true); onBusyChange(true); setNotice(null);
    const gate = saveEpoch.current, epoch = gate.start();
    try {
      const receipt = await repository.saveLearning(pending.input);
      if (!gate.accepts(epoch) || receipt.user_id !== owner) return;
      let removed = false;
      try { removed = removeLearningDraft(window.localStorage, pending, baseline.current); } catch { /* Exact server readback succeeded; retain an uncertain local cleanup. */ }
      draftRef.current = null; baseline.current = null; setDraft(null); setLocalStatus(''); setLocalError(removed ? '' : '서버 저장은 확인했지만 기기 보관본은 남아 있을 수 있어요.'); readDrafts();
      setSuccess(`복습 서버 저장 확인 · 보고서 버전 ${receipt.lesson_revision} · 근거 버전 ${receipt.version} · ${receipt.payload.events.length}건. 저장 응답과 별도 재조회가 정확히 일치해요.`);
    } catch (error) {
      if (!gate.accepts(epoch)) return;
      const next = noticeFor(error); setNotice(next);
      if (next.code === 'validation' || next.code === 'conflict' || next.code === 'schema_unavailable') store({ ...pending, submitted: false, reviewed: false });
    } finally {
      if (gate.accepts(epoch)) {
        busyRef.current = false; setBusy(false); onBusyChange(false);
        // A pending retry can interrupt an in-flight snapshot read. Replace that
        // read even after failure, rather than leaving its loading state stuck.
        void refresh();
      }
    }
  };

  const currentLessons = snapshot?.lessons.filter(lesson => lesson.operation !== 'delete') ?? [];
  const latestLesson = currentLessons.filter(lesson => lesson.report.lessonDate).sort((a, b) => b.report.lessonDate!.localeCompare(a.report.lessonDate!) || b.created_at.localeCompare(a.created_at))[0];
  const selected = currentLessons.find(lesson => lesson.lesson_id === selectedId);
  const errors = draft ? validateLiveLearningInput(draft.input) : [];
  const frozen = busy || Boolean(draft?.submitted) || !usable || staleDraft;
  return <div className="live-learning-workspace" hidden={!active}>
    <section className="live-card" aria-labelledby="learning-title"><div className="live-toolbar"><h2 id="learning-title">복습·학습 상태</h2><button type="button" disabled={loading || busy} onClick={() => void refresh()}>복습 기록 새로고침</button></div>
      <p>저장한 보고서의 근거를 직접 확인하면 영역별 상태와 복습일을 계산해요. 다음 AI 수업 준비 메뉴에서 이 기록을 지시문으로 만들 수 있어요.</p>
      {loading ? <p role="status">수업과 복습 기록을 함께 확인하는 중…</p> : null}
      {readError ? <div className="live-notice live-notice-error" role="alert"><strong>{readError.code === 'schema_unavailable' ? '복습 전용 서버 저장소가 아직 준비되지 않았어요.' : '최신 복습 기록을 확인하지 못했어요.'}</strong><p>{readError.text} 기록이 없는 상태로 처리하지 않았어요. 최신 상태와 복습일 표시는 보류합니다.</p></div> : null}
      {busy ? <p role="status">복습 근거 저장 후 서버에서 다시 확인하는 중…</p> : null}
      {success ? <p className="live-notice live-notice-success" role="status">{success}</p> : null}
      {notice ? <p className="live-notice live-notice-error" role="alert">{notice.text}</p> : null}
    </section>
    {usable && projection ? <><section className="live-card" aria-label="Live 학습 현황"><h2>최근 Live 수업</h2><p>현재 보관한 수업 {currentLessons.length}회 · 최근 수업일 {latestLesson?.report.lessonDate ?? '미확인'}</p><p>최근 확인한 학습 단계: {latestLesson?.report.stage || '미확인'}</p><p className="live-hint">재학습 필요 {projection.states.filter(state => state.status === 'relearn_needed').length}개 영역 · 숙달 확인 {projection.states.filter(state => state.status === 'mastery_confirmed').length}개 영역 · 날짜 없는 수업 {currentLessons.filter(lesson => !lesson.report.lessonDate).length}회는 최근 수업일 계산에서 제외해요.</p></section><LearningDashboard projection={projection} today={today} /></> : null}
    <section className="live-card" aria-labelledby="live-confirm-source-title"><h2 id="live-confirm-source-title">보고서의 학습 근거 확인</h2>
      <p className="live-hint">수업 저장만으로 평가를 만들지 않아요. 수정·삭제된 보고서의 근거는 현재 상태 계산에서 제외하며 이전 이력은 보존해요.</p>
      {usable && projection ? <p>{projection.unconfirmedLessons.length}개 수업의 현재 버전에 확인한 관찰이 없어요.</p> : null}
      {recovered.length ? <details className="live-source"><summary>이 계정의 복습 기기 초안 {recovered.length}개</summary><div className="live-card live-draft-list"><p className="live-hint">불러올 때마다 이 탭만 수정하는 별도 초안을 만들어요. 이미 서버에 저장된 보관본이 남아 있을 수 있어요.</p>{recovered.map(value => <button type="button" key={value.draftId} disabled={busy || Boolean(draft && localError)} onClick={() => recover(value)}>복습 초안 · {dateTime(value.updatedAt)} · 보고서 버전 {value.input.lessonRevision}{value.submitted ? ' · 저장 결과 확인 필요' : ''}</button>)}</div></details> : null}
      {localStatus ? <p className="live-hint" role="status">{localStatus}</p> : null}
      {localError ? <div className="live-notice live-notice-error" role="alert">{localError}{draft ? <button type="button" disabled={busy} onClick={separate}>현재 복습 입력을 별도 초안으로 보관</button> : null}</div> : null}
      <label htmlFor="live-learning-lesson">근거를 확인할 수업</label><select id="live-learning-lesson" value={selectedId} disabled={!usable || busy} onChange={event => setSelectedId(event.target.value)}><option value="">수업을 선택해 주세요</option>{currentLessons.map(lesson => <option value={lesson.lesson_id} key={lesson.lesson_id}>{lesson.report.lessonDate ?? '날짜 미확인'} · {lesson.report.topic || '주제 미확인'} · 버전 {lesson.revision}</option>)}</select>
      <div className="live-actions"><button type="button" disabled={!selected || !usable || busy || Boolean(draft && localError)} onClick={() => selected && begin(selected)}>이 수업의 근거 확인 시작</button></div>
      {usable && !currentLessons.length ? <p>먼저 보고서 가져오기에서 수업을 저장해 주세요. 휴지통의 수업은 근거로 사용할 수 없어요.</p> : null}
      {draft ? <section className="live-learning-editor" aria-labelledby="live-learning-draft-title"><h3 id="live-learning-draft-title">확인 중인 관찰 목록</h3><p>{currentLesson?.report.topic || '수업 내용 확인 필요'} · 보고서 버전 {draft.input.lessonRevision} · 기존 근거 버전 {draft.input.expectedVersion}</p>
        <p className="live-hint">아래 전체 목록으로 이 보고서 버전의 현재 근거를 대체해요. 이전 저장본은 이력에 남습니다. 다른 수업의 관찰은 바뀌지 않아요.</p>
        {draft.submitted ? <p className="live-notice live-notice-warning">저장 결과를 아직 확인하지 못했어요. 입력을 잠그고 같은 요청으로 다시 조회·저장해 중복을 막습니다.</p> : null}
        {usable && staleDraft ? <div className="live-notice live-notice-warning"><p>보고서 또는 근거 버전이 바뀌었어요. 기존 초안을 그대로 덮어쓰지 않아요.</p>{currentLesson?.operation === 'delete' ? <p>이 수업은 휴지통에 있어요. 학습 이력에서 보고서를 복원한 뒤 현재 버전에 근거를 직접 복사하고 다시 확인해 주세요.</p> : <button type="button" disabled={busy || draft.submitted || Boolean(localError)} onClick={rebaseDraft}>현재 버전에 이 초안 복사</button>}</div> : null}
        <ul className="live-list">{draft.input.events.map(event => <li key={event.eventId}><LearningEventSummary event={event} />{exactSource && learningSourceProblems(event, exactSource).length ? <p className="live-notice live-notice-warning">현재 보고서와 근거를 다시 대조해 주세요.</p> : null}<div className="live-actions"><button type="button" disabled={frozen || Boolean(draft.entry)} onClick={() => changeDraft({ ...draft, entry: structuredClone(event), entryReviewed: false, reviewed: false })}>이 관찰 수정</button><button type="button" disabled={frozen || Boolean(draft.entry)} onClick={() => changeDraft({ ...draft, input: { ...draft.input, events: draft.input.events.filter(value => value.eventId !== event.eventId) }, reviewed: false })}>확인 목록에서 제외</button></div></li>)}</ul>
        {!draft.input.events.length ? <p>확인한 관찰이 아직 없어요. 빈 목록을 저장하면 이 보고서 버전의 기존 근거가 현재 계산에서 제외돼요.</p> : null}
        {draft.entry && exactSource ? <LearningEventEditor entry={draft.entry} reviewed={draft.entryReviewed} lesson={exactSource} items={items} relearning={relearning} disabled={frozen} onChange={updateEntry}
          onReview={value => changeDraft({ ...draft, entryReviewed: value, reviewed: false })} onConfirm={confirmEntry} onCancel={() => changeDraft({ ...draft, entry: null, entryReviewed: false })} /> : draft.entry ? <p className="live-notice live-notice-warning">입력 중인 관찰도 초안에 보존했어요. 현재 보고서 버전을 확인한 뒤 이어서 작성해 주세요.</p> : null}
        <div className="live-actions"><button type="button" disabled={frozen || Boolean(draft.entry) || draft.input.events.length >= LIVE_LEARNING_MAX_EVENTS} onClick={() => updateEntry(blankLearningEvent(crypto.randomUUID(), crypto.randomUUID(), exactSource?.report.lessonDate ?? null))}>관찰 한 건 추가</button><button type="button" disabled={frozen || Boolean(draft.entry) || !draft.input.events.length} onClick={() => setClearRequested(true)}>모든 관찰 비우기</button></div>
        {clearRequested ? <div className="live-confirm"><p>이 확인 목록을 비울까요? 서버 저장 전까지 기존 기록은 그대로예요. 빈 목록을 저장해도 이전 이력은 남아요.</p><div className="live-actions"><button type="button" disabled={frozen} onClick={() => { changeDraft({ ...draft, input: { ...draft.input, events: [] }, reviewed: false }); setClearRequested(false); }}>확인 목록 비우기</button><button type="button" onClick={() => setClearRequested(false)}>비우기 취소</button></div></div> : null}
        <label htmlFor="live-learning-change-reason">전체 근거 목록의 저장·변경 이유</label><textarea id="live-learning-change-reason" rows={2} value={draft.input.changeReason} disabled={frozen} onChange={event => changeDraft({ ...draft, input: { ...draft.input, changeReason: event.target.value }, reviewed: false })} />
        <label className="live-checkbox"><input type="checkbox" checked={draft.reviewed} disabled={frozen || Boolean(draft.entry)} onChange={event => changeDraft({ ...draft, reviewed: event.target.checked })} /><span>이 수업의 전체 관찰 목록과 원문 근거를 확인했고 이 내용으로 저장할게요.</span></label>
        {errors.length && draft.reviewed ? <p className="live-notice live-notice-warning">{errors.join(' ')}</p> : null}
        <div className="live-actions"><button type="button" className="live-primary" disabled={busy || !draft.reviewed || Boolean(draft.entry) || errors.length > 0 || storageChanged || (!draft.submitted && (!usable || staleDraft))} onClick={() => void save()}>{draft.submitted ? '같은 요청으로 복습 저장 다시 확인' : '확인한 복습 근거 서버에 저장'}</button><button type="button" disabled={busy || draft.submitted} onClick={() => setDiscardRequested(true)}>이 복습 초안 지우기</button></div>
        {discardRequested ? <div className="live-confirm"><p>현재 기기 초안만 지울까요? 저장한 수업과 복습 이력은 바뀌지 않아요.</p><button type="button" disabled={busy || draft.submitted} onClick={discard}>복습 초안 지우기 확인</button><button type="button" onClick={() => setDiscardRequested(false)}>초안 지우기 취소</button></div> : null}
      </section> : null}
    </section>
    {usable && projection && snapshot ? <section className="live-card" aria-labelledby="live-evidence-history-title"><h2 id="live-evidence-history-title">근거 저장·수정 이력</h2><p className="live-hint">등록 시각과 실제 관찰일은 따로 보존해요. 현재 계산에서 제외된 근거도 남아 있어요. 보고서 복원만으로 이전 근거가 자동 활성화되지 않아요.</p>
      {!snapshot.batches.length ? <p>아직 저장한 근거 이력이 없어요.</p> : [...snapshot.batches].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.version - a.version).map(batch => {
        const source = snapshot.lessons.find(lesson => lesson.lesson_id === batch.lesson_id);
        const isActive = projection.activeBatches.includes(batch);
        return <details className="live-source" key={batch.request_id}><summary>{source?.report.topic || '수업'} · 보고서 버전 {batch.lesson_revision} · 근거 버전 {batch.version} · {isActive ? '현재 반영' : '현재 계산 제외'}</summary><div className="live-field-group-body"><p className="live-hint">등록 {dateTime(batch.created_at)} (한국 시간) · 관찰 {batch.payload.events.length}건</p><p className="live-preserved-text">변경 이유: {batch.payload.changeReason}</p>{batch.payload.events.map(event => <div className="live-history-event" key={event.eventId}><LearningEventSummary event={event} /></div>)}{!isActive && source && source.operation !== 'delete' ? <><p className="live-hint">명시적으로 복사한 뒤 현재 보고서의 원문 근거와 전체 목록을 다시 확인해 저장해야 반영돼요. 원래 관찰일은 유지합니다.</p><button type="button" disabled={busy || Boolean(draft && localError)} onClick={() => begin(source, batch)}>이 근거를 현재 버전에 복사해 확인</button></> : source?.operation === 'delete' ? <p className="live-hint">휴지통 수업의 근거예요. 보고서 복원 전에는 다시 반영할 수 없어요.</p> : null}</div></details>;
      })}
    </section> : null}
  </div>;
}
