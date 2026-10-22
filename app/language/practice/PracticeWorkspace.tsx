'use client';

import { useEffect, useRef, useState } from 'react';
import Recorder from './Recorder';
import ConfirmedConversationArchive from '@/components/ConfirmedConversationArchive';
import { getConversation, MAX_TEXT, MAX_TURNS, parseJournal, requestFor, SITUATIONS, type Journal, type Situation, type Transport, type Turn } from './conversation';

// No production transport is supplied until provider/cost/privacy approval.
export default function PracticeWorkspace({ owner, transport }: { owner: string; transport?: Transport }) {
  const [journal, setJournal] = useState<Journal>({ version: 1, owner, turns: [] });
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const [situation, setSituation] = useState<Situation>('일상');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [target, setTarget] = useState('ゆっくり話してください。');
  const [archiveSelection, setArchiveSelection] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const unsaved = useRef<{ owner: string; turn: Turn } | null>(null);
  const [unsavedTurn, setUnsavedTurn] = useState<Turn | null>(null);
  const active = useRef(true);
  const storageKey = `japanese-practice-tab-v1:${owner}`;
  const current = useRef(journal);

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
    if (current.current.turns.length >= MAX_TURNS) { setNotice('이 탭에는 30개까지 보관해요. 필요 없는 기록을 먼저 삭제해 주세요.'); return; }
    let request;
    try { request = requestFor(current.current.turns, situation, text); }
    catch (e) { setNotice((e as Error).message); return; }
    if (send && !transport) { setNotice('자유 AI 대화 서비스가 연결되지 않았어요. 문장은 연습 기록으로 보관할 수 있어요.'); return; }
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setNotice('');
    const timeout = setTimeout(() => { controller.abort(); }, 20000);
    try {
      const reply = send ? await getConversation(transport!, request, controller.signal) : undefined;
      if (!active.current || controller.signal.aborted || pending.current !== controller) return;
      const turn: Turn = { id: crypto.randomUUID(), text: request.message, situation, review: false, practiced: 0, ...(reply ? { reply } : {}) };
      if (persist([...current.current.turns, turn])) { setText(''); setNotice(reply ? 'AI 응답과 입력을 이 탭에 보관했어요. 정확성은 직접 확인해 주세요.' : '직접 쓴 문장을 이 탭에 보관했어요. AI가 교정하거나 채점한 결과는 아니에요.'); }
      else { unsaved.current = { owner, turn }; setUnsavedTurn(turn); }
    } catch (e) {
      if (pending.current === controller) setNotice(controller.signal.aborted ? '응답 대기 시간이 지났어요. 입력을 유지했으니 필요하면 다시 보내 주세요.' : e instanceof Error ? e.message : '응답을 받지 못했어요.');
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
      unsaved.current = null; setUnsavedTurn(null); setText('');
      setNotice('AI를 다시 호출하지 않고 이 탭에 보관했어요.');
    } catch { setNotice('탭 저장을 다시 완료하지 못했어요. 받은 내용은 이 화면에 유지되며 기존 기록은 덮어쓰지 않았어요.'); }
  }
  function cancel() { pending.current?.abort(); pending.current = null; setBusy(false); setNotice('요청을 취소했어요. 입력은 유지했어요.'); }
  useEffect(() => {
    active.current = true;
    const stop = () => { active.current = false; pending.current?.abort(); pending.current = null; unsaved.current = null; };
    const leave = () => { stop(); setUnsavedTurn(null); setText(''); setJournal({ version: 1, owner, turns: [] }); setReady(false); setBusy(false); setNotice('화면을 떠나 임시 응답을 비웠어요. 연습 화면을 다시 열어 주세요.'); };
    window.addEventListener('pagehide', leave);
    return () => { stop(); window.removeEventListener('pagehide', leave); };
  }, [owner]);
  const visible = journal.turns.filter(t => !reviewOnly || t.review);
  const selected = journal.turns.find(t => t.id === archiveSelection);
  return <section style={{ maxWidth: 800, margin: '0 auto', overflowWrap: 'anywhere' }}>
    <h1>자유 문장 연습과 발음</h1>
    <p>직접 쓴 문장, 대화 기록, 다시 연습할 문장을 모아 보세요. 이 기록은 현재 계정의 이 탭에만 보관되며 계정 동기화·영구 학습 기록이 아니에요. 탭을 닫으면 사라질 수 있어요.</p>
    <p>{transport ? 'AI 답변은 학습 참고용이며 전문 발음 평가가 아니에요.' : '자유 AI 대화: 서비스 연결 대기 · 지금은 AI 응답과 교정을 제공하지 않아요.'}</p>
    <a href="/language/conversation">상황별 회화로 돌아가기</a>
    <div className="card">
      <label>연습 상황 <select value={situation} disabled={busy || !!unsavedTurn} onChange={e => setSituation(e.target.value as Situation)}>{SITUATIONS.map(s => <option key={s}>{s}</option>)}</select></label>
      <label style={{ display: 'block' }}>자유 일본어 문장<textarea value={text} maxLength={MAX_TEXT} disabled={!ready || busy || !!unsavedTurn} onChange={e => setText(e.target.value)} rows={4} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
      <p>{text.length}/{MAX_TEXT}자</p>
      <button className="btn" disabled={!ready || busy || !!unsavedTurn || !text.trim()} onClick={() => void save(false)}>연습 기록 보관</button>{' '}
      <button className="btn" disabled={!ready || busy || !!unsavedTurn || !text.trim() || !transport} onClick={() => void save(true)}>AI와 대화하기</button>{' '}
      {busy && <button className="btn" onClick={cancel}>요청 취소</button>}
    </div>
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
    <h2>이 탭의 학습 기록 ({journal.turns.length}/{MAX_TURNS})</h2>
    <label><input type="checkbox" checked={reviewOnly} onChange={e => setReviewOnly(e.target.checked)} /> 복습할 문장만 보기</label>
    {!visible.length && <p>표시할 기록이 없어요. 문장을 보관하거나 복습 표시를 해 주세요.</p>}
    {visible.map(turn => <article className="card" key={turn.id} aria-label={`연습 기록 ${turn.situation}`}>
      <p>{turn.situation} · {turn.reply ? 'AI 응답 포함' : '직접 입력 · 미교정'}</p>
      <p lang="ja">{turn.text}</p>
      {turn.reply && <><p lang="ja">{turn.reply.reply}</p><p lang="ja">{turn.reply.replyReading}</p><p>교정 참고: <span lang="ja">{turn.reply.correction}</span></p><p>{turn.reply.explanation}</p></>}
      <button className="btn" disabled={busy} onClick={() => persist(current.current.turns.map(t => t.id === turn.id ? { ...t, review: !t.review } : t))}>{turn.review ? '복습 표시 해제' : '복습에 표시'}</button>{' '}
      <button className="btn" disabled={busy} onClick={() => { setTarget(turn.reply?.correction || turn.text); setNotice('아래 발음 자기 점검에서 이 문장을 연습해 주세요.'); }}>이 문장 발음 연습</button>{' '}
      <button className="btn" disabled={busy} onClick={() => persist(current.current.turns.map(t => t.id === turn.id ? { ...t, practiced: t.practiced + 1 } : t))}>직접 재연습 완료</button>{' '}
      <button className="btn" disabled={busy} onClick={() => persist(current.current.turns.filter(t => t.id !== turn.id))}>이 기록 삭제</button>
      <p>자기 보고 재연습 {turn.practiced}회 · 발음 점수 아님</p>
      <button type="button" className="btn" disabled={busy} onClick={() => setArchiveSelection(turn.id)}>계정 보관 대상으로 선택</button>
    </article>)}
    <ConfirmedConversationArchive key={owner} ownerId={owner} kind="japanese-practice" candidate={selected ? { version: 1, kind: 'japanese-practice', turn: selected } : null} onRestore={snapshot => {
      if (!ready || busy || snapshot.kind !== 'japanese-practice') return;
      if (current.current.turns.some(t => t.id === snapshot.turn.id)) { setNotice('같은 문장의 탭 기록이 이미 있어요. 현재 복습·연습 상태를 덮어쓰지 않았어요.'); return; }
      if (current.current.turns.length >= MAX_TURNS) { setNotice('이 탭의 30개 보관 한도에 도달했어요. 기존 기록은 유지됩니다.'); return; }
      if (persist([...current.current.turns, snapshot.turn])) setNotice('계정 보관본을 이 탭으로 가져왔어요. 계정의 원본 보관본은 바뀌지 않았어요.');
    }} />
    <Recorder text={target} />
  </section>;
}
