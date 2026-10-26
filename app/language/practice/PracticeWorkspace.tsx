'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useUnsavedChanges } from '@/components/useUnsavedChanges';
import { openPracticeInputDraft, updatePracticeInputDraft } from './inputDraft';
import Recorder from './Recorder';
import ConfirmedConversationArchive from '@/components/ConfirmedConversationArchive';
import { getConversation, MAX_TEXT, MAX_TURNS, parseJournal, requestFor, SITUATIONS, type Journal, type Situation, type Transport, type Turn } from './conversation';

// Each user explicitly consents before sending text to the free-only transport.
export default function PracticeWorkspace({ owner, transport }: { owner: string; transport?: Transport }) {
  const [inputDraft] = useState(() => openPracticeInputDraft(owner));
  const [journal, setJournal] = useState<Journal>({ version: 1, owner, turns: [] });
  const [ready, setReady] = useState(false);
  const [text, setTextState] = useState(inputDraft.draft?.text ?? '');
  const [dataUseAcknowledged, setDataUseAcknowledged] = useState(false);
  const [situation, setSituationState] = useState<Situation>(inputDraft.draft?.situation ?? '일상');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [target, setTarget] = useState('ゆっくり話してください。');
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [archiveSelection, setArchiveSelection] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const unsaved = useRef<{ owner: string; turn: Turn; inputRevision: number } | null>(null);
  const [unsavedTurn, setUnsavedTurn] = useState<Turn | null>(null);
  useUnsavedChanges(Boolean(text.trim() || busy || unsavedTurn));
  const active = useRef(true);
  const storageKey = `japanese-practice-tab-v1:${owner}`;
  const current = useRef(journal);

  function setText(value: string, options?: { claim?: boolean; expectedRevision?: number }) {
    setTextState(value);
    updatePracticeInputDraft(inputDraft, { text: value, situation }, options);
  }
  function setSituation(value: Situation) {
    setSituationState(value);
    updatePracticeInputDraft(inputDraft, { text, situation: value });
  }

  useEffect(() => {
    active.current = true;
    const stop = () => { active.current = false; pending.current?.abort(); pending.current = null; unsaved.current = null; };
    const leave = () => { stop(); setUnsavedTurn(null); setText(''); setJournal({ version: 1, owner, turns: [] }); setReady(false); setBusy(false); setNotice('화면을 떠나 임시 응답을 비웠어요. 연습 화면을 다시 열어 주세요.'); };
    window.addEventListener('pagehide', leave);
    return () => { stop(); window.removeEventListener('pagehide', leave); };
  }, [owner]);
  useEffect(() => {
    setReady(false);
    if (!active.current) return;
    try {
      const restored = parseJournal(sessionStorage.getItem(storageKey), owner);
      current.current = restored; setJournal(restored); setReady(true);
      setResetRequested(false);
      setNotice(readAttempt ? '기존 탭 기록을 다시 불러왔어요. 기록은 변경하지 않았어요.' : '');
    } catch { setNotice('이 탭의 기록을 읽지 못했어요. 기존 기록은 변경하지 않았어요. 저장 공간을 확인한 뒤 다시 불러올 수 있어요.'); }
    return () => pending.current?.abort();
  }, [owner, storageKey, readAttempt]);

  function persist(turns: Turn[]) {
    if (!ready || !active.current || current.current.owner !== owner) return false;
    const next: Journal = { version: 1, owner, turns };
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setNotice('탭 기록을 저장하지 못했어요. 입력은 유지했어요. 브라우저 저장 공간을 확인해 주세요.'); return false; }
    current.current = next; setJournal(next); return true;
  }
  async function save(send: boolean) {
    if (!ready || !active.current || pending.current || unsaved.current) return;
    if (send && !dataUseAcknowledged) { setNotice('Google 전송 및 무료 서비스 자료 활용 안내에 먼저 동의해 주세요.'); return; }
    if (current.current.turns.length >= MAX_TURNS) { setNotice('이 탭에는 30개까지 보관해요. 필요 없는 기록을 먼저 삭제해 주세요.'); return; }
    let request;
    try { request = requestFor(current.current.turns, situation, text); }
    catch (e) { setNotice((e as Error).message); return; }
    if (send && !transport) { setNotice('자유 AI 대화 서비스가 연결되지 않았어요. 문장은 연습 기록으로 보관할 수 있어요.'); return; }
    const controller = new AbortController();
    const submittedInputRevision = inputDraft.revision;
    pending.current = controller; setBusy(true); setNotice('');
    // Bounded end-to-end budget: includes session/auth/network overhead around the 18s provider limit.
    const timeout = setTimeout(() => { controller.abort(); }, 30000);
    try {
      const reply = send ? await getConversation(transport!, request, controller.signal) : undefined;
      if (!active.current || controller.signal.aborted || pending.current !== controller) return;
      const turn: Turn = { id: crypto.randomUUID(), text: request.message, situation, review: false, practiced: 0, ...(reply ? { reply } : {}) };
      if (persist([...current.current.turns, turn])) { setText('', { expectedRevision: submittedInputRevision }); setNotice(reply ? 'AI 응답과 입력을 이 탭에 보관했어요. 정확성은 직접 확인해 주세요.' : '직접 쓴 문장을 이 탭에 보관했어요. AI가 교정하거나 채점한 결과는 아니에요.'); }
      else { unsaved.current = { owner, turn, inputRevision: submittedInputRevision }; setUnsavedTurn(turn); }
    } catch (e) {
      if (pending.current === controller) setNotice(controller.signal.aborted ? '기다리는 시간이 길어 답변을 확인하지 못했어요. 입력은 그대로예요. 서버에서 처리됐을 수 있어 자동으로 다시 보내지 않아요.' : e instanceof Error ? e.message : '응답을 받지 못했어요.');
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  function retryStorage() {
    const draft = unsaved.current;
    if (!active.current || !ready || pending.current || !draft || draft.owner !== owner) return;
    try {
      // Read again so another local edit is not overwritten by a stale journal.
      const latest = parseJournal(sessionStorage.getItem(storageKey), owner);
      const existing = latest.turns.find(t => t.id === draft.turn.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(draft.turn)) throw Error('같은 기록의 내용이 달라 저장하지 않았어요. 기존 기록은 유지됩니다.');
      if (!existing && latest.turns.length >= MAX_TURNS) throw Error('탭 보관 한도에 도달했어요. 받은 응답과 기존 기록은 유지됩니다.');
      if (!existing && !persist([...latest.turns, draft.turn])) return;
      if (existing) { current.current = latest; setJournal(latest); }
      unsaved.current = null; setUnsavedTurn(null); setText('', { expectedRevision: draft.inputRevision });
      setNotice('AI를 다시 호출하지 않고 이 탭에 보관했어요.');
    } catch { setNotice('탭 저장을 다시 완료하지 못했어요. 받은 내용은 이 화면에 유지되며 기존 기록은 덮어쓰지 않았어요.'); }
  }
  function cancel() { pending.current?.abort(); pending.current = null; setBusy(false); setNotice('요청을 취소했어요. 입력은 유지했어요.'); }
  const visible = journal.turns.filter(t => !reviewOnly || t.review);
  const selected = journal.turns.find(t => t.id === archiveSelection);
  const latest = journal.turns.at(-1);
  const summaryStyle = { cursor: 'pointer', padding: '12px 0', minHeight: 44 };
  return <section className="practice-page" style={{ maxWidth: 800, margin: '0 auto', overflowWrap: 'anywhere' }}>
    <Link href="/language/conversation">← 상황별 회화</Link>
    <h1>일본어로 이야기해요</h1>
    <div className="card practice-start">
      <label style={{ display: 'block', marginBottom: 6 }}>이야기 주제 <select style={{ maxWidth: '100%', minHeight: 44 }} value={situation} disabled={busy || !!unsavedTurn} onChange={e => setSituation(e.target.value as Situation)}>{SITUATIONS.map(s => <option key={s}>{s}</option>)}</select></label>
      <label style={{ display: 'block' }} htmlFor="practice-message">일본어 문장</label>
      <textarea id="practice-message" aria-describedby="practice-input-help" placeholder="こんにちは。 (안녕하세요.)" value={text} maxLength={MAX_TEXT} disabled={!ready || busy || !!unsavedTurn} onChange={e => setText(e.target.value, { claim: true })} rows={2} style={{ width: '100%', boxSizing: 'border-box', fontSize: '1rem' }} />
      <p className="text-xs text-gray-600">입력 중인 문장만 이 탭에서 이어 써요. 새로고침·로그아웃하면 지워져요. 자동 전송하거나 기록에 저장하지 않아요.</p>
      <p id="practice-input-help"><span lang="ja">こんにちは。</span> = 안녕하세요 · 읽기: 곤니치와 <span>({text.length}/{MAX_TEXT}자)</span></p>
      {!text.trim() && <button type="button" className="practice-example" disabled={!ready || busy || !!unsavedTurn} onClick={() => setText('こんにちは。', { claim: true })}>이 문장으로 시작 (입력만)</button>}
      {transport ? <>
        <p id="practice-data-use">Google Gemini에 이 문장과 같은 주제의 최근 대화 최대 4쌍을 보내요. 입력·답변은 Google 제품 개선에 쓰일 수 있어요. 다른 앱 기록·녹음은 보내지 않아요. 개인정보는 쓰지 마세요.</p>
        <label style={{ display: 'block', padding: '6px 0', minHeight: 44 }}><input type="checkbox" aria-describedby="practice-data-use" checked={dataUseAcknowledged} disabled={busy} onChange={e => setDataUseAcknowledged(e.target.checked)} />위 내용을 확인하고 전송에 동의해요.</label>
      </> : <p>지금은 AI에 연결할 수 없어요. 아래에서 문장만 보관할 수 있어요.</p>}
      <button className="btn" style={{ width: '100%', minHeight: 48 }} disabled={!ready || busy || !!unsavedTurn || !text.trim() || !transport || !dataUseAcknowledged} onClick={() => void save(true)}>AI와 대화하기</button>
      {busy && <p role="status">답변을 기다리고 있어요. 최대 30초 기다려요. <button className="btn" onClick={cancel}>요청 취소</button></p>}
      <details><summary style={summaryStyle}>AI에 보내지 않고 문장만 보관하기</summary><p>이 브라우저 탭에만 남아요. 탭을 닫으면 사라질 수 있어요.</p><button className="btn" disabled={!ready || busy || !!unsavedTurn || !text.trim()} onClick={() => void save(false)}>연습 기록 보관</button></details>
    </div>
    {latest?.reply && !unsavedTurn && <section className="card" aria-label="방금 나눈 대화">
      <h2>AI의 답변이에요</h2>
      <p>내가 쓴 말</p><p lang="ja">{latest.text}</p>
      <p>AI의 답변</p><p lang="ja" style={{ fontSize: '1.2rem' }}>{latest.reply.reply}</p>
      <details><summary style={summaryStyle}>읽는 법과 설명 보기</summary><p>읽는 법</p><p lang="ja">{latest.reply.replyReading}</p><p>문장 다듬기</p><p lang="ja">{latest.reply.correction}</p><p>{latest.reply.explanation}</p><p>AI도 틀릴 수 있어요. 공부할 때 참고해 주세요.</p></details>
      <p>대화를 이어가려면 위 입력칸에 다음 말을 써 주세요.</p>
    </section>}
    <p role="status">{notice}</p>
    {unsavedTurn && <div className="card" aria-label="아직 저장하지 못한 연습">
      <p>받은 내용은 이 화면의 메모리에만 있어요. 새로고침·화면 이동·계정 변경 시 사라집니다. 저장 재시도는 AI를 호출하지 않아요.</p>
      <p lang="ja">{unsavedTurn.text}</p>
      {unsavedTurn.reply && <><p lang="ja">{unsavedTurn.reply.reply}</p><p lang="ja">{unsavedTurn.reply.replyReading}</p><p lang="ja">{unsavedTurn.reply.correction}</p><p>{unsavedTurn.reply.explanation}</p></>}
      <button type="button" className="btn" onClick={retryStorage}>탭 저장만 다시 시도</button>
      <button type="button" className="btn" onClick={() => { unsaved.current = null; setUnsavedTurn(null); setNotice('임시 내용만 비웠어요. 입력은 유지되며 다시 보내면 새 요청이 됩니다.'); }}>임시 응답 비우기</button>
    </div>}
    {!ready && active.current && <div className="card">
      <button type="button" className="btn" onClick={() => setReadAttempt(attempt => attempt + 1)}>기존 탭 기록 다시 불러오기</button>
      <p>다시 불러오기는 기록을 삭제하거나 덮어쓰지 않아요. 계속 읽지 못할 때만 아래 초기화를 검토해 주세요.</p>
      {!resetRequested ? <button className="btn" onClick={() => setResetRequested(true)}>이 탭 기록 초기화 검토</button> : <>
        <p>읽지 못한 이 탭의 연습 기록만 삭제해요. 기존 문장 복습·계정 학습 기록은 삭제하지 않아요.</p>
        <button className="btn" onClick={() => {
          try {
            sessionStorage.removeItem(storageKey);
            const empty: Journal = { version: 1, owner, turns: [] };
            current.current = empty; setJournal(empty); setReady(true); setResetRequested(false); setNotice('이 탭의 연습 기록을 비웠어요.');
          } catch { setNotice('기록을 삭제하지 못했어요. 브라우저 저장 공간 설정을 확인해 주세요.'); }
        }}>이 탭 기록만 삭제</button>{' '}
        <button className="btn" onClick={() => setResetRequested(false)}>삭제 취소</button>
      </>}
    </div>}
    <details className="card"><summary style={summaryStyle}>이전 대화와 복습 ({journal.turns.length}/{MAX_TURNS})</summary>
    <p>이 탭에만 보관한 기록이에요. 탭을 닫으면 사라질 수 있어요. 오래 보관하려면 문장을 선택해 아래 계정 보관함에 저장해 주세요.</p>
    <label><input type="checkbox" checked={reviewOnly} onChange={e => setReviewOnly(e.target.checked)} /> 복습할 문장만 보기</label>
    {!visible.length && <p>표시할 기록이 없어요. 문장을 보관하거나 복습 표시를 해 주세요.</p>}
    {visible.map(turn => <article className="card" key={turn.id} aria-label={`연습 기록 ${turn.situation}`}>
      <p>{turn.situation} · {turn.reply ? 'AI 응답 포함' : '직접 입력 · 미교정'}</p>
      <p lang="ja">{turn.text}</p>
      {turn.reply && <><p lang="ja">{turn.reply.reply}</p><p lang="ja">{turn.reply.replyReading}</p><p>교정 참고: <span lang="ja">{turn.reply.correction}</span></p><p>{turn.reply.explanation}</p></>}
      <details><summary style={summaryStyle}>이 문장으로 더 연습하기</summary>
      <button className="btn" disabled={busy} onClick={() => persist(current.current.turns.map(t => t.id === turn.id ? { ...t, review: !t.review } : t))}>{turn.review ? '복습 표시 해제' : '복습에 표시'}</button>{' '}
      <button className="btn" disabled={busy} onClick={() => { setTarget(turn.reply?.correction || turn.text); setRecorderOpen(true); setNotice('아래 발음 자기 점검에서 이 문장을 연습해 주세요.'); }}>이 문장 발음 연습</button>{' '}
      <button className="btn" disabled={busy} onClick={() => persist(current.current.turns.map(t => t.id === turn.id ? { ...t, practiced: t.practiced + 1 } : t))}>직접 재연습 완료</button>{' '}
      <button className="btn" disabled={busy} onClick={() => persist(current.current.turns.filter(t => t.id !== turn.id))}>이 기록 삭제</button>
      <p>자기 보고 재연습 {turn.practiced}회 · 발음 점수 아님</p>
      <button type="button" className="btn" disabled={busy} onClick={() => setArchiveSelection(turn.id)}>계정 보관 대상으로 선택</button>
      </details>
    </article>)}
    </details>
    <details className="card" open={!!archiveSelection || undefined}><summary style={summaryStyle}>계정에 보관한 문장</summary>
    <ConfirmedConversationArchive key={owner} ownerId={owner} kind="japanese-practice" candidate={selected ? { version: 1, kind: 'japanese-practice', turn: selected } : null} onRestore={snapshot => {
      if (!ready || busy || snapshot.kind !== 'japanese-practice') return;
      if (current.current.turns.some(t => t.id === snapshot.turn.id)) { setNotice('같은 문장의 탭 기록이 이미 있어요. 현재 복습·연습 상태를 덮어쓰지 않았어요.'); return; }
      if (current.current.turns.length >= MAX_TURNS) { setNotice('이 탭의 30개 보관 한도에 도달했어요. 기존 기록은 유지됩니다.'); return; }
      if (persist([...current.current.turns, snapshot.turn])) setNotice('계정 보관본을 이 탭으로 가져왔어요. 계정의 원본 보관본은 바뀌지 않았어요.');
    }} />
    </details>
    <details className="card" open={recorderOpen} onToggle={e => setRecorderOpen(e.currentTarget.open)}><summary style={summaryStyle}>내 목소리로 연습하기 (선택)</summary>
    {recorderOpen && <Recorder key={owner} text={target} owner={owner} />}
    </details>
  </section>;
}
