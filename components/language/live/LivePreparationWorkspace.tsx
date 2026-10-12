'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLanguageLiveLearningRepository } from '@/app/data/languageLiveLearningRepository';
import { createLanguageLivePreparationRepository } from '@/app/data/languageLivePreparationRepository';
import { LiveRequestEpoch } from '@/app/language/live/draft-state';
import { createPreparationDraft, forkPreparationDraft, persistPreparationDraft, preparationDraftKey, preparationDraftPrefix, readPreparationDrafts, removePreparationDraft, type LivePreparationDraft } from '@/app/language/live/preparation-draft';
import { buildLivePreparation, isLivePreparationCurrent } from '@/lib/language-live/preparation';
import { validateLivePreparationInput } from '@/lib/language-live/preparation-validation';
import { LIVE_PREPARATION_MAX_TEXT, type LivePreparationRecord } from '@/lib/language-live/preparation-types';
import { isLiveCalendarDate } from '@/lib/language-live/review-policy';
import type { LiveLearningSnapshot } from '@/lib/language-live/learning-types';
import { LanguageLiveError } from '@/lib/language-live/types';

const koreanDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateTime = (value: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value));
const message = (error: unknown) => error instanceof LanguageLiveError ? error.message : '연결을 확인하지 못했어요. 입력은 유지되니 다시 확인해 주세요.';

export default function LivePreparationWorkspace({ owner, client, active, onBusyChange }: { owner: string; client: SupabaseClient; active: boolean; onBusyChange: (busy: boolean) => void }) {
  const learning = useMemo(() => createLanguageLiveLearningRepository(client, owner), [client, owner]);
  const repository = useMemo(() => createLanguageLivePreparationRepository(client, owner), [client, owner]);
  const readEpoch = useRef(new LiveRequestEpoch()), operationEpoch = useRef(new LiveRequestEpoch());
  const busyRef = useRef(false), baseline = useRef<string | null>(null), draftRef = useRef<LivePreparationDraft | null>(null);
  const copyTextRef = useRef<HTMLTextAreaElement | null>(null);
  const [snapshot, setSnapshot] = useState<LiveLearningSnapshot | null>(null);
  const [records, setRecords] = useState<LivePreparationRecord[]>([]);
  const [loading, setLoading] = useState(true), [readError, setReadError] = useState(''), [historyError, setHistoryError] = useState('');
  const [draft, setDraft] = useState<LivePreparationDraft | null>(null), [selected, setSelected] = useState<LivePreparationRecord | null>(null);
  const [recovered, setRecovered] = useState<LivePreparationDraft[]>([]);
  const [forDate, setForDate] = useState(koreanDate), [maxItems, setMaxItems] = useState(5);
  const [busy, setBusy] = useState(false), [copyPhase, setCopyPhase] = useState<'checking' | 'writing' | null>(null);
  const [notice, setNotice] = useState(''), [success, setSuccess] = useState(''), [localError, setLocalError] = useState(''), [localStatus, setLocalStatus] = useState('');
  const [localWarning, setLocalWarning] = useState('');
  const [discardRequested, setDiscardRequested] = useState(false), [manualCopy, setManualCopy] = useState(false);
  const usable = Boolean(snapshot && !loading && !readError);
  const preparation = draft?.input.preparation ?? selected?.payload.preparation;
  const stale = Boolean(preparation && snapshot && !isLivePreparationCurrent(preparation, snapshot));
  const historyStale = Boolean(draft && records.some(record => record.preparation_id === draft.input.preparationId && record.revision > draft.input.expectedRevision));

  const readDrafts = useCallback(() => {
    try {
      const result = readPreparationDrafts(window.localStorage, owner); setRecovered(result.drafts);
      setLocalWarning(result.unreadable ? '읽을 수 없는 수업 준비 초안이 있어요. 지우지 않고 보존했어요.' : '');
    } catch { setLocalWarning('기기 초안 목록을 읽을 수 없어요. 화면의 입력과 개별 보관 상태를 확인해 주세요.'); }
  }, [owner]);
  const refresh = useCallback(async () => {
    const gate = readEpoch.current, epoch = gate.start(); setLoading(true); setReadError(''); setHistoryError('');
    const [source, history] = await Promise.allSettled([learning.readLearning(), repository.listPreparations()]);
    if (!gate.accepts(epoch)) return;
    if (source.status === 'fulfilled') setSnapshot(source.value); else setReadError(message(source.reason));
    if (history.status === 'fulfilled') setRecords(history.value); else setHistoryError(message(history.reason));
    setLoading(false);
  }, [learning, repository]);
  useEffect(() => {
    readEpoch.current = new LiveRequestEpoch(); operationEpoch.current = new LiveRequestEpoch(); busyRef.current = false; onBusyChange(false); readDrafts();
    const changed = (event: StorageEvent) => {
      if ((event.storageArea && event.storageArea !== window.localStorage) || (event.key !== null && !event.key.startsWith(preparationDraftPrefix(owner)))) return;
      readDrafts();
      if (draftRef.current && (event.key === null || event.key === preparationDraftKey(owner, draftRef.current.draftId)) && event.newValue !== baseline.current) {
        setLocalStatus(''); setLocalError('다른 탭에서 초안이 바뀌었거나 지워졌어요. 현재 입력을 별도 초안으로 보관해 주세요.');
      }
    };
    window.addEventListener('storage', changed);
    return () => { readEpoch.current.close(); operationEpoch.current.close(); onBusyChange(false); window.removeEventListener('storage', changed); };
  }, [owner, onBusyChange, readDrafts]);
  useEffect(() => {
    if (!active) { readEpoch.current.invalidate(); operationEpoch.current.invalidate(); busyRef.current = false; setBusy(false); setCopyPhase(null); onBusyChange(false); return; }
    void refresh();
    const update = () => { if (document.visibilityState === 'visible' && !busyRef.current) void refresh(); };
    window.addEventListener('focus', update); window.addEventListener('online', update); document.addEventListener('visibilitychange', update);
    return () => { readEpoch.current.invalidate(); operationEpoch.current.invalidate(); window.removeEventListener('focus', update); window.removeEventListener('online', update); document.removeEventListener('visibilitychange', update); };
  }, [active, refresh, onBusyChange]);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const leave = (event: MouseEvent) => {
      if (!(event.target as Element).closest?.('a[href]') || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!window.confirm('서버 저장을 확인하지 않은 수업 준비 초안이 있어요. 기기 보관 상태를 확인한 뒤 이동할까요?')) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn); document.addEventListener('click', leave, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', leave, true); };
  }, [draft]);

  const store = (next: LivePreparationDraft, expected = baseline.current) => {
    draftRef.current = next; setDraft(next); setSelected(null); setSuccess(''); setManualCopy(false);
    try { baseline.current = persistPreparationDraft(window.localStorage, next, expected); setLocalError(''); setLocalStatus('수업 준비 기기 초안 보관됨 · 서버 저장 전'); readDrafts(); return true; }
    catch (error) { setLocalStatus(''); setLocalError(error instanceof Error && error.message === 'draft_changed' ? '다른 탭의 최신 초안을 덮어쓰지 않았어요. 별도 초안으로 보관해 주세요.' : '기기 초안을 보관하지 못했어요. 화면을 닫기 전에 입력을 별도로 복사해 주세요.'); return false; }
  };
  const ids = () => ({ draftId: crypto.randomUUID(), preparationId: crypto.randomUUID(), requestId: crypto.randomUUID(), now: new Date().toISOString() });
  const generate = () => {
    if (!usable || !snapshot || busyRef.current || (draftRef.current && localError)) return;
    try { const next = createPreparationDraft(owner, buildLivePreparation(snapshot, forDate, maxItems), ids()); baseline.current = null; store(next, null); setNotice(''); setDiscardRequested(false); }
    catch { setNotice('준비 날짜와 분량을 확인해 주세요. 지시문을 만들지 못했으며 기존 입력은 유지했어요.'); }
  };
  const change = (text: string, reviewed = false) => {
    const current = draftRef.current; if (!current || busyRef.current || current.submitted) return;
    store({ ...current, reviewed, updatedAt: new Date().toISOString(), input: { ...current.input, requestId: crypto.randomUUID(), editedText: text } }); setNotice('');
  };
  const recover = (listed: LivePreparationDraft) => {
    if (busyRef.current || (draftRef.current && localError)) return;
    try {
      const current = readPreparationDrafts(window.localStorage, owner).drafts.find(value => value.draftId === listed.draftId);
      if (!current || JSON.stringify(current) !== window.localStorage.getItem(preparationDraftKey(owner, listed.draftId))) throw Error('changed');
      baseline.current = null; store(forkPreparationDraft(current, crypto.randomUUID(), new Date().toISOString()), null); setNotice(''); setDiscardRequested(false);
    } catch { setLocalError('초안을 안전하게 열지 못했어요. 원래 보관본은 유지했어요.'); }
  };
  const separate = () => {
    if (!draftRef.current || busyRef.current) return;
    const next = forkPreparationDraft(draftRef.current, crypto.randomUUID(), new Date().toISOString()); baseline.current = null; store(next, null);
  };
  const close = () => {
    if (busyRef.current || (draftRef.current && localError)) return;
    operationEpoch.current.invalidate(); draftRef.current = null; baseline.current = null; setDraft(null); setSelected(null); setNotice(''); setSuccess(''); setLocalStatus(''); setDiscardRequested(false); setManualCopy(false);
  };
  const discard = () => {
    const current = draftRef.current; if (!current || current.submitted || busyRef.current) return;
    try {
      if (!removePreparationDraft(window.localStorage, current, baseline.current)) throw Error('changed');
      draftRef.current = null; baseline.current = null; setDraft(null); setSelected(null); setLocalError(''); setLocalStatus(''); setNotice(''); setDiscardRequested(false); readDrafts();
    } catch { setLocalError('초안이 바뀌었거나 삭제를 확인하지 못했어요. 입력은 그대로 보존했어요.'); }
  };
  const setWorking = (value: boolean) => { busyRef.current = value; setBusy(value); onBusyChange(value); };
  const save = async () => {
    const current = draftRef.current;
    if (!current || busyRef.current || !current.reviewed || localError || validateLivePreparationInput(current.input).length || (!current.submitted && (!usable || stale || historyStale || historyError))) return;
    const pending = { ...current, submitted: true }; if (!store(pending)) return;
    readEpoch.current.invalidate(); setWorking(true); setNotice('');
    const gate = operationEpoch.current, epoch = gate.start();
    try {
      const result = await repository.savePreparation(pending.input);
      if (!gate.accepts(epoch) || result.user_id !== owner) return;
      let removed = false; try { removed = removePreparationDraft(window.localStorage, pending, baseline.current); } catch { /* A verified receipt remains valid even when local cleanup fails. */ }
      draftRef.current = null; baseline.current = null; setDraft(null); setSelected(result); setLocalStatus(''); setLocalError(removed ? '' : '서버 저장은 확인했지만 기기 초안 보관본은 남아 있을 수 있어요.'); readDrafts();
      setSuccess(`수업 준비 서버 저장 확인 · 버전 ${result.revision}. 별도 재조회로 원본과 수정본을 확인했어요.`);
    } catch (error) {
      if (!gate.accepts(epoch)) return;
      setNotice(message(error));
      if (error instanceof LanguageLiveError && ['validation', 'conflict', 'schema_unavailable'].includes(error.code)) store({ ...pending, submitted: false, reviewed: false });
    } finally { if (gate.accepts(epoch)) { setWorking(false); void refresh(); } }
  };
  const openRecord = (record: LivePreparationRecord) => {
    if (busyRef.current || (draftRef.current && localError)) return;
    draftRef.current = null; baseline.current = null; setDraft(null); setSelected(record); setNotice(''); setSuccess(''); setLocalStatus(''); setManualCopy(false); setDiscardRequested(false);
  };
  const editRecord = () => {
    if (!selected || busyRef.current || loading || historyError) return;
    const head = records.filter(record => record.preparation_id === selected.preparation_id).sort((a, b) => b.revision - a.revision)[0];
    const next = createPreparationDraft(owner, selected.payload.preparation, ids(), head?.revision === selected.revision ? selected : undefined);
    next.input.editedText = selected.payload.editedText;
    baseline.current = null; store(next, null);
  };
  const copy = async () => {
    const record = selected;
    if (!record || busyRef.current || !usable || stale) return;
    const gate = operationEpoch.current, epoch = gate.start(); setWorking(true); setCopyPhase('checking'); setNotice(''); setSuccess(''); setManualCopy(false);
    try {
      const current = await learning.readLearning();
      if (!gate.accepts(epoch)) return;
      setSnapshot(current);
      if (!isLivePreparationCurrent(record.payload.preparation, current)) { setNotice('생성 뒤 학습 기록이 바뀌었어요. 최신 자료로 새 지시문을 만들어 주세요. 예전 지시문은 이력으로 남아요.'); return; }
      setCopyPhase('writing');
      try {
        if (!navigator.clipboard?.writeText) throw Error('clipboard_unavailable');
        await navigator.clipboard.writeText(record.payload.editedText);
        if (gate.accepts(epoch)) setSuccess('클립보드에 복사했어요. ChatGPT 일본어 선생님 방에 직접 붙여넣어 주세요. 자동 전송되지는 않아요.');
      } catch { if (gate.accepts(epoch)) { setManualCopy(true); setNotice('자동 복사를 허용하지 않았거나 지원하지 않아요. 아래 내용을 선택해 직접 복사해 주세요.'); } }
    } catch (error) { if (gate.accepts(epoch)) { setReadError(message(error)); setNotice('최신 출처를 확인하지 못해 복사를 중단했어요. 빈 기록으로 처리하지 않았어요.'); } }
    finally { if (gate.accepts(epoch)) { setWorking(false); setCopyPhase(null); } }
  };
  const cancelCopy = () => { if (copyPhase !== 'checking') return; operationEpoch.current.invalidate(); setWorking(false); setCopyPhase(null); setNotice('복사 전 확인을 취소했어요. 저장된 지시문은 그대로예요.'); };
  const problems = draft ? validateLivePreparationInput(draft.input) : [];

  return <div className="live-preparation-workspace" hidden={!active}>
    <section className="live-card" aria-labelledby="live-prepare-title"><div className="live-toolbar"><h2 id="live-prepare-title">다음 AI 수업 준비</h2><button type="button" disabled={loading || busy} onClick={() => void refresh()}>준비 자료 새로고침</button></div>
      <p>서버에서 확인한 보고서와 영역별 근거로 지시문을 만들어요. 내용을 검토해 저장한 뒤 직접 복사해 주세요.</p><p className="live-hint">유료 AI 호출이나 ChatGPT 대화 자동 수집·전송은 없어요. 개인 정보와 회사 기밀이 포함됐는지 복사 전에 확인해 주세요.</p>
      {loading ? <p role="status">최신 수업·복습 자료와 준비 이력을 확인하는 중…</p> : null}
      {readError ? <p role="alert" className="live-notice live-notice-error">{readError} 기록이 없는 상태로 처리하지 않았어요. 생성·복사를 보류합니다.</p> : null}
      {historyError ? <p role="alert" className="live-notice live-notice-warning">{historyError} 준비 이력 조회·서버 저장은 사용할 수 없어요. 현재 자료로 만든 기기 초안은 보존해요.</p> : null}
      {notice ? <p role="alert" className="live-notice live-notice-warning">{notice}</p> : null}{success ? <p role="status" className="live-notice live-notice-success">{success}</p> : null}
      <div className="live-learning-grid"><label>준비할 수업 날짜 (한국 시간)<input id="live-preparation-date" type="date" value={forDate} disabled={busy} onChange={event => setForDate(event.target.value)} /></label><label>한 번에 확인할 영역 수<select value={maxItems} disabled={busy} onChange={event => setMaxItems(Number(event.target.value))}>{[3, 5, 10].map(value => <option key={value} value={value}>{value}개까지</option>)}</select></label></div>
      <button type="button" className="live-primary" disabled={!usable || busy || !isLiveCalendarDate(forDate) || Boolean(draft && localError)} onClick={generate}>최신 자료로 새 지시문 생성</button>
      <p className="live-hint">재학습·지난 복습일·추가 평가를 먼저 선택해요. 새로 생성해도 기존 초안과 서버 이력은 덮어쓰지 않아요.</p>
    </section>
    {recovered.length ? <details className="live-source"><summary>이 계정의 수업 준비 기기 초안 {recovered.length}개</summary><div className="live-card live-draft-list"><p className="live-hint">기기 초안은 이 브라우저에만 있어요. 불러올 때 탭마다 별도 보관본을 만들어요. 서버 저장본은 아래 이력에서 확인해 주세요.</p>{recovered.map(value => <button type="button" key={value.draftId} disabled={busy || Boolean(draft && localError)} onClick={() => recover(value)}>준비 초안 · {value.input.preparation.forDate} · {dateTime(value.updatedAt)}{value.submitted ? ' · 저장 결과 확인 필요' : ''}</button>)}</div></details> : null}
    {localWarning ? <p role="alert" className="live-notice live-notice-warning">{localWarning}</p> : null}
    {localStatus ? <p role="status" className="live-hint">{localStatus}</p> : null}{localError ? <div role="alert" className="live-notice live-notice-error">{localError}{draft ? <button type="button" disabled={busy} onClick={separate}>현재 준비 입력을 별도 초안으로 보관</button> : null}</div> : null}
    {preparation ? <section className="live-card" aria-labelledby="live-preparation-preview"><div className="live-toolbar"><h2 id="live-preparation-preview">지시문 확인</h2><button type="button" disabled={busy || Boolean(draft && localError)} onClick={close}>지시문 닫기</button></div>
      <p className="live-hint">{preparation.forDate} · {preparation.timezone} · {preparation.templateVersion} · {preparation.policyVersion}</p>
      {stale ? <p role="alert" className="live-notice live-notice-warning">생성 뒤 학습 자료가 바뀐 과거 지시문이에요. 수정·삭제된 수업은 새 생성에 반영되지만 예전 지시문 이력은 남아요. 최신 자료로 다시 생성해 주세요.</p> : null}
      {historyStale ? <p role="alert" className="live-notice live-notice-warning">다른 곳에서 더 최신 준비 버전을 저장했어요. 현재 입력은 보존했으니 최신 이력을 열어 확인해 주세요.</p> : null}
      {draft ? <><label htmlFor="live-preparation-text">전달할 지시문 (직접 수정 가능)</label><textarea id="live-preparation-text" rows={18} maxLength={LIVE_PREPARATION_MAX_TEXT} value={draft.input.editedText} disabled={busy || draft.submitted} onChange={event => change(event.target.value)} />
        <label className="live-checkbox"><input type="checkbox" checked={draft.reviewed} disabled={busy || draft.submitted} onChange={event => change(draft.input.editedText, event.target.checked)} /><span>내용·출처·불확실성과 개인 정보 포함 여부를 검토했어요.</span></label>
        {problems.length && draft.reviewed ? <p role="alert">{problems.join(' ')}</p> : null}
        <div className="live-actions"><button type="button" className="live-primary" disabled={busy || !draft.reviewed || Boolean(localError) || problems.length > 0 || (!draft.submitted && (!usable || stale || historyStale || Boolean(historyError)))} onClick={() => void save()}>{draft.submitted ? '같은 요청으로 준비 저장 다시 확인' : '확인본 서버에 저장'}</button><button type="button" disabled={busy || draft.submitted} onClick={() => setDiscardRequested(true)}>이 준비 초안 지우기</button></div>
        {discardRequested ? <div className="live-confirm"><p>현재 기기 초안만 지울까요? 서버에 저장한 지시문과 수업 기록은 유지돼요.</p><button type="button" disabled={busy} onClick={discard}>준비 초안 지우기 확인</button><button type="button" onClick={() => setDiscardRequested(false)}>초안 지우기 취소</button></div> : null}</> : selected ? <>
        <p className="live-badge">서버 조회 확인 · 버전 {selected.revision} · {dateTime(selected.created_at)}</p><label htmlFor="live-preparation-copy-text">저장한 전달용 지시문</label><textarea id="live-preparation-copy-text" ref={copyTextRef} rows={18} readOnly value={selected.payload.editedText} />
        <p className="live-hint">{records.some(record => record.preparation_id === selected.preparation_id && record.revision > selected.revision) ? '과거 버전의 수정은 별도 준비문으로 저장해요. 기존 준비문의 최신 버전과 이력은 그대로 남아요.' : '최신 버전을 수정해 저장하면 같은 준비문에 새 버전을 추가해요.'}</p>
        <div className="live-actions"><button type="button" className="live-primary" disabled={busy || !usable || stale} onClick={() => void copy()}>수업 지시문 복사</button><button type="button" disabled={busy || loading || Boolean(historyError)} onClick={editRecord}>이 버전으로 수정 시작</button></div>
        <p className="live-hint">클립보드 쓰기 요청 후에는 앱에서 취소할 수 없어요. 로그아웃·계정 변경 뒤에도 기기에 복사될 수 있으니 결과를 확인해 주세요.</p>
        {copyPhase ? <p role="status">{copyPhase === 'checking' ? '복사 전에 최신 출처를 다시 확인하는 중…' : '클립보드 복사 결과를 확인하는 중…'}</p> : null}{copyPhase === 'checking' ? <button type="button" onClick={cancelCopy}>복사 확인 취소</button> : null}
        {manualCopy ? <button type="button" disabled={busy || !usable || stale} onClick={() => { if (busyRef.current || !usable || stale) return; copyTextRef.current?.focus(); copyTextRef.current?.select(); }}>지시문 전체 선택</button> : null}
      </> : null}
      <details className="live-source"><summary>생성 원본·선택 이유·출처 보기</summary><div className="live-field-group-body"><p className="live-preserved-text">{preparation.generatedText}</p>{preparation.selected.map(item => <p key={`${item.itemId}:${item.skill}`}>{item.text} · {item.skill} · {item.reason}</p>)}{preparation.references.map(reference => <p className="live-hint" key={reference.lessonId}>수업 {reference.lessonId} · 보고서 버전 {reference.lessonRevision} · {reference.fields.join(', ')}</p>)}</div></details>
    </section> : null}
    <section className="live-card" aria-labelledby="live-preparation-history"><h2 id="live-preparation-history">이전 수업 준비 이력</h2><p className="live-hint">서버에 저장한 생성 원본과 수정본을 버전별로 보존해요. 출처 수업을 휴지통으로 옮겨도 이미 저장한 지시문은 과거 이력으로 남아요.</p>
      {historyError ? <p>준비 이력을 확인하지 못했어요. 빈 이력으로 표시하지 않았어요.</p> : loading ? <p>준비 이력 확인 중…</p> : !records.length ? <p>아직 서버에 저장한 수업 준비가 없어요.</p> : <ul className="live-list">{records.map(record => <li key={`${record.preparation_id}:${record.revision}`}><strong>{record.payload.preparation.forDate} · 버전 {record.revision}</strong><p className="live-hint">{dateTime(record.created_at)} · {usable && snapshot ? isLivePreparationCurrent(record.payload.preparation, snapshot) ? '조회 시점 자료와 일치' : '과거 자료 기준' : '최신 출처 확인 필요'}</p><button type="button" disabled={busy || Boolean(draft && localError)} onClick={() => openRecord(record)}>준비 버전 {record.revision} 보기</button></li>)}</ul>}
    </section>
  </div>;
}
