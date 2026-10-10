"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RubySegment } from "@/data/sentences";
import { authenticatedJsonHeaders } from "@/app/lib/authenticatedHeaders";
import { FREE_MODE } from "@/lib/free-mode";
import { buildFreeConversation, FREE_CONVERSATIONS } from "@/data/freeConversation";
import { japaneseAudioErrorMessage, speakJapaneseWithPreferredTts } from "@/utils/speakJapanese";

type Situation = "카페" | "여행" | "일상" | "업무" | "친구";

type ChatMessage =
  | {
      role: "user";
      text: string;
    }
  | {
      role: "assistant";
      reply: string;
      replyReading: string;
      replyRubySegments?: RubySegment[];
      replyKoreanPronunciation: string;
      correction: string;
      correctionReading: string;
      correctionRubySegments?: RubySegment[];
      correctionKoreanPronunciation: string;
      explanation: string;
      originalUserText: string; // 어떤 입력에 대한 교정인지 비교용
    };

const SITUATIONS: Situation[] = ["카페", "여행", "일상", "업무", "친구"];
import { useLanguageRecordSnapshot } from "@/components/language/useLanguageRecordSnapshot";
import { languageSettingsProjectionError, loadJapaneseAppSettings } from "@/app/data/languageSettingsMutations";
import { LEGACY_FREE_CONVERSATION_SCRIPTS, FREE_CONVERSATION_CONTEXTS, FREE_CONVERSATION_LEVELS, findFreeConversationCoverage } from "@/data/freeConversationCatalog";
import { findGuidedConversationScript } from "@/data/guidedConversationPilot";
import { useConversationSession } from "@/components/language/useConversationSession";
import { ConversationSessionRecap } from "@/components/language/ConversationSessionRecap";
import { projectClosedConversationRecap } from "@/lib/conversation-session/recap";
import { CLOUD_SESSION_CHANGED_EVENT } from "@/app/data/storageTransaction";
import { RECORD_RESET_EVENT } from "@/app/data/appRecordReset";

const localStatusText = {
  unavailable: "저장 상태를 확인할 수 없어요.",
  idle: "새 대화를 시작하거나 저장된 기록을 열어 주세요.",
  unsaved: "입력 중 · 아직 저장되지 않았어요",
  saving: "입력을 저장하고 있어요. 아직 저장 확인 전이에요.",
  pending: "보류 중 · 전송 또는 종료 결과를 확인하고 있어요.",
  uncertain: "저장 결과를 확인하지 못했어요. 입력을 보존하고 먼저 다시 확인해 주세요.",
  saved: "기기에 저장했어요",
} as const;

function sessionTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
}

export default function ConversationPage() {
  // The paid page keeps its existing provider path. Local sessions are only
  // mounted in free mode; a free send never reaches that handler.
  if (FREE_MODE) return <LocalConversationPage />;
  return <LegacyPaidConversationPage />;
}

function LocalConversationPage() {
  const flow = useConversationSession();
  const { observeExposure } = flow;
  const { records, snapshot: settingsSnapshot } = useLanguageRecordSnapshot();
  const settings = loadJapaneseAppSettings(records.japaneseAppSettings).sections.conversation;
  const settingsError = languageSettingsProjectionError({ japaneseAppSettings: records.japaneseAppSettings });
  const [previewScriptId, setPreviewScriptId] = useState("legacy-daily");
  const [practiceKind, setPracticeKind] = useState<'guided' | 'legacy'>('legacy');
  const [contextId, setContextId] = useState('convenience-store');
  const [levelId, setLevelId] = useState('beginner');
  const [hintTarget, setHintTarget] = useState<string | null>(null);
  const selectionSerial = useRef(0);
  const [acceptedIdentity, setAcceptedIdentity] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [playingAudioKey, setPlayingAudioKey] = useState<string | null>(null);
  const audioRequest = useRef<AbortController | null>(null);
  const audioView = useRef<{ identity: string | null; sessionId: string | null; revision: number | null } | null>(null);
  const composing = useRef(false);
  const session = flow.session;
  const selectedScriptId = previewScriptId;
  const preview = LEGACY_FREE_CONVERSATION_SCRIPTS.find(script => script.scriptId === selectedScriptId);
  const cell = findFreeConversationCoverage(contextId, levelId);
  const guidedPreview = cell?.availability === 'available' ? findGuidedConversationScript(cell.scriptId, cell.scriptRevision) : undefined;
  const selection = practiceKind === 'legacy' ? selectedScriptId : guidedPreview ? { kind: 'guided' as const, scriptId: guidedPreview.scriptId, scriptRevision: guidedPreview.scriptRevision } : null;
  const content = session ? ('japanese' in session.source.content ? session.source.content : null) : preview?.content;
  const activeStep = flow.activeStep;
  const currentHintTarget = flow.activeStepRef ? JSON.stringify([flow.identity, session?.sessionId, flow.activeStepRef]) : null;
  const hintVisible = currentHintTarget !== null && hintTarget === currentHintTarget;
  const editable = flow.available && Boolean(settingsSnapshot) && flow.canEdit && !session?.closed;
  const accepted = flow.available && flow.identity !== null && acceptedIdentity === flow.identity;

  const stopAudio = useCallback(() => {
    audioRequest.current?.abort();
    audioRequest.current = null;
    setPlayingAudioKey(null);
  }, []);

  useEffect(() => {
    const hide = () => { if (document.visibilityState !== "visible") stopAudio(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stopAudio);
    window.addEventListener(CLOUD_SESSION_CHANGED_EVENT, stopAudio);
    window.addEventListener(RECORD_RESET_EVENT, stopAudio);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stopAudio);
      window.removeEventListener(CLOUD_SESSION_CHANGED_EVENT, stopAudio);
      window.removeEventListener(RECORD_RESET_EVENT, stopAudio);
      stopAudio();
    };
  }, [stopAudio]);

  useEffect(() => {
    audioView.current = { identity: flow.identity, sessionId: session?.sessionId ?? null, revision: session?.stateRevision ?? null };
    return () => { audioView.current = null; stopAudio(); };
  }, [flow.identity, session?.sessionId, session?.stateRevision, session?.source.scriptRevision, editable, stopAudio]);

  useEffect(() => {
    const signal = flow.snapshot?.context.signal;
    if (signal?.aborted) stopAudio();
    signal?.addEventListener("abort", stopAudio);
    return () => { signal?.removeEventListener("abort", stopAudio); stopAudio(); };
  }, [flow.snapshot?.context.signal, stopAudio]);

  useEffect(() => { composing.current = false; }, [flow.identity, session?.sessionId]);

  // Each observation follows this committed DOM and its exact rendered head.
  // Transcript fallback/help belongs to the answered step, never the next one.
  useEffect(() => {
    if (!flow.available || !settingsSnapshot || !session || session.closed || flow.unsupported || document.visibilityState !== "visible") return;
    if (flow.guided) {
      if (activeStep && flow.activeStepRef) observeExposure({ example: "shown", meaning: "shown",
        ...(settings.showReading || settings.showKoreanPronunciation ? { reading: "shown" as const } : {}),
        ...(hintVisible ? { hint: "shown" as const } : {}) }, flow.activeStepRef);
      for (const turn of session.turns) if ('kind' in turn.emission && turn.emission.kind === 'guided-fixed-emission') {
        observeExposure({ hint: 'shown', ...(turn.emission.exampleFallback ? { example: 'shown', meaning: 'shown',
          ...(settings.showReading || settings.showKoreanPronunciation ? { reading: 'shown' as const } : {}) } : {}) }, turn.draft.source);
      }
    } else if (editable) observeExposure({ example: "shown", meaning: "shown", ...(settings.showReading || settings.showKoreanPronunciation ? { reading: "shown" as const } : {}),
      ...(session.turns.length ? { hint: "shown" as const } : {}) });
  }, [settingsSnapshot, flow.available, flow.guided, flow.unsupported, flow.activeStepRef, activeStep, hintVisible, editable, session, settings.showReading, settings.showKoreanPronunciation, observeExposure]);

  const changeSelection = async (change: () => void) => {
    const serial = ++selectionSerial.current;
    stopAudio();
    if (await flow.leave() && serial === selectionSerial.current) change();
  };
  const handleSituationChange = (scriptId: string) => changeSelection(() => setPreviewScriptId(scriptId));
  const handleStart = () => {
    if (!accepted || flow.busy || !selection) return;
    stopAudio();
    const serial = selectionSerial.current;
    void flow.start(selection, () => selectionSerial.current === serial);
  };

  const handleSend = () => {
    if (composing.current || !editable || !flow.canSend || flow.busy || !flow.input.trim() || flow.input.length > 8000) return;
    stopAudio();
    void flow.send();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat || composing.current) return;
    event.preventDefault();
    handleSend();
  };

  const handleExampleAudio = async () => {
    // Only the currently editable fixed example is audible. Saved turns,
    // recovery drafts, history and closed recap have no audio actions.
    if (flow.guided || !editable || !session || !content || playingAudioKey || audioRequest.current || document.visibilityState !== "visible" || !flow.checkCurrent()) return;
    const currentView = audioView.current;
    if (!currentView || currentView.identity !== flow.identity || currentView.sessionId !== session.sessionId || currentView.revision !== session.stateRevision) return;
    const request = new AbortController();
    audioRequest.current = request;
    setAudioError(null);
    setPlayingAudioKey("example");
    try {
      await speakJapaneseWithPreferredTts(content.japanese, { rate: settings.ttsRate, repeatCount: settings.repeatCount, repeatDelayMs: settings.repeatDelayMs, signal: request.signal });
    } catch (error) {
      if (!request.signal.aborted && audioRequest.current === request) setAudioError(japaneseAudioErrorMessage(error));
    } finally {
      if (audioRequest.current === request) {
        audioRequest.current = null;
        setPlayingAudioKey(null);
      }
    }
  };

  if (!flow.available || !settingsSnapshot) return <section role="status">
    <h1>상황별 회화 연습</h1>
    <p>{flow.error || "계정과 학습 설정의 저장 상태를 확인하지 못했어요. 다시 확인해 주세요."}</p>
    <p>확인 중에는 대화 내용을 숨겨요. 저장되지 않은 입력의 복구는 보장하지 않아요.</p>
    <button type="button" className="btn" disabled={flow.busy} onClick={() => void flow.recover()}>저장 다시 확인</button>
  </section>;

  const recap = session?.closed && flow.snapshot?.envelope
    ? projectClosedConversationRecap(flow.snapshot.envelope, session.sessionId) : null;
  const pending = flow.pendingOperation;
  const overLimit = flow.input.length > 8000;
  const retainedInput = Boolean(flow.input && (!session || session.closed));
  const history = [...flow.sessions].sort((left, right) =>
    Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.sessionId.localeCompare(right.sessionId));

  return <section style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <div className="page-header">
      <h1>상황별 회화 연습</h1>
      <p className="muted">고정 연습 예문 · 자유 문장은 평가하지 않아요</p>
    </div>
    {settingsError && <p role="alert">{settingsError}</p>}

    <section className="card" aria-label="이 브라우저의 대화 저장 안내" style={{ marginBottom: 14 }}>
      <strong>이 브라우저에만 저장 · 다른 기기와 동기화되지 않아요</strong>
      <p>새 대화를 시작하면 입력한 대화와 보내지 않은 초안을 이 브라우저에 보관해요. 대화 삭제, 언어 기록 초기화, 브라우저 데이터 삭제 전까지 남을 수 있어요.</p>
      <p>대화는 암호화되지 않으며 같은 사이트의 스크립트가 접근할 수 있어요. 공용 브라우저에서는 주의해 주세요. 로그아웃하면 화면에서는 숨겨지지만 기록은 남고, 같은 계정으로 확인되면 다시 열 수 있어요.</p>
      <p>브라우저 데이터 삭제나 저장 공간 문제로 기록을 잃을 수 있어요. 영구 보관이나 백업을 보장하지 않아요. 오프라인에서는 계정·초기화 상태를 다시 확인하지 못해 이용이 중단될 수 있어요.</p>
      <p>저장 확인 전의 마지막 입력은 새로고침·뒤로 가기·창 닫기 때 사라질 수 있어요. 이동 전 ‘입력 저장’으로 확인해 주세요.</p>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" checked={accepted} onChange={event => setAcceptedIdentity(event.target.checked ? flow.identity : null)} />
        <span>위 보관 안내를 확인했어요.</span>
      </label>
    </section>

    <section className="card" aria-label="새 대화 선택" style={{ marginBottom: 14 }}>
      <p>수준별 연습 3/24개 이용 가능 · 나머지 21개는 참고 자료만 있음 · 대화 준비 중</p>
      <p>기존 다섯 예문은 수준 미지정이며 위 24개와 별개예요.</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <button type="button" className="btn" aria-pressed={practiceKind === 'guided'} disabled={flow.busy} onClick={() => void changeSelection(() => setPracticeKind('guided'))}>수준별 연습 선택</button>
        <button type="button" className="btn" aria-pressed={practiceKind === 'legacy'} disabled={flow.busy} onClick={() => void changeSelection(() => setPracticeKind('legacy'))}>기존 예문 선택</button>
      </div>
      {practiceKind === 'guided' ? <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="conversation-context">상황</label>
        <select id="conversation-context" value={contextId} disabled={flow.busy} onChange={event => { const value = event.target.value; void changeSelection(() => setContextId(value)); }}>
          {FREE_CONVERSATION_CONTEXTS.map(context => <option key={context.id} value={context.id}>{context.label}</option>)}
        </select>
        <label htmlFor="conversation-level">수준</label>
        <select id="conversation-level" value={levelId} disabled={flow.busy} onChange={event => { const value = event.target.value; void changeSelection(() => setLevelId(value)); }}>
          {FREE_CONVERSATION_LEVELS.map(level => <option key={level.id} value={level.id}>{level.label}</option>)}
        </select>
        {!guidedPreview && <p role="status">참고 자료만 있음 · 대화 준비 중. 이 상황과 수준의 대화는 아직 시작할 수 없어요.</p>}
      </div> : <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="conversation-situation">기존 예문 · 수준 미지정</label>
        <select id="conversation-situation" value={selectedScriptId} disabled={flow.busy} onChange={event => void handleSituationChange(event.target.value)}>
          {LEGACY_FREE_CONVERSATION_SCRIPTS.map(script => <option key={script.scriptId} value={script.scriptId}>{script.label}</option>)}
        </select>
      </div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button type="button" className="btn" disabled={!accepted || flow.busy || !selection} onClick={handleStart}>새 대화 시작</button>
        <button type="button" className="btn" disabled={flow.busy || !session} onClick={() => { stopAudio(); void flow.leave(); }}>기록 보기</button>
      </div>
    </section>

    <p role="status" aria-live="polite" data-save-status={flow.status}>{localStatusText[flow.status]}</p>
    {flow.error && <p role="alert">{flow.error}</p>}
    {flow.missing && <p role="alert">선택한 대화를 현재 기록에서 확인하지 못했어요. 입력을 다른 대화에 자동으로 옮기지 않아요.</p>}
    {flow.unsupported && <p role="status">저장된 예문이나 응답 기준을 현재 버전에서 지원하지 않아 읽기만 가능해요. 당시 저장된 문장과 초안을 그대로 표시하며, 현재 예문으로 다시 만들지 않아요. 이 기록을 삭제하거나 별도의 새 대화를 시작할 수 있어요.</p>}
    {retainedInput && <section className="card" aria-label="화면에 보존한 미저장 입력" style={{ marginBottom: 14 }}>
      <h2>화면에 보존한 미저장 입력</h2>
      <p role="status">대화가 종료되었거나 원본을 확인하지 못해 입력을 읽기 전용으로 남겼어요. 이 입력의 저장은 확인되지 않았으며 종료 요약의 보낸 문장에 추가되지 않았어요. 새로고침하거나 창을 닫기 전에 필요한 내용을 직접 보관해 주세요.</p>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{flow.input}</p>
    </section>}
    {(flow.status === "uncertain" || flow.status === "pending" || flow.error || pending) && <section className="card" aria-label="저장 확인과 복구" style={{ marginBottom: 14 }}>
      <p>먼저 저장된 결과를 다시 확인해 주세요. 확인되지 않은 전송을 자동으로 다시 보내지 않아요.</p>
      <button type="button" className="btn" disabled={flow.busy} onClick={() => void flow.recover()}>저장 다시 확인</button>
      {pending && <>
        <p>{pending.kind === "append" ? "보류 전송을 취소하면 해당 문장을 보내지 않은 초안으로 남겨요. 이미 전송이 확정됐다면 그 결과를 확인해요." : "보류 중인 종료를 취소하면 대화와 기존 초안을 그대로 남겨요. 이미 종료가 확정됐다면 그 결과를 확인해요."}</p>
        <button type="button" className="btn" disabled={flow.busy} onClick={() => void flow.cancelPending()}>{pending.kind === "append" ? "보류 전송 취소" : "보류 종료 취소"}</button>
      </>}
    </section>}
    {(flow.status === "unsaved" || retainedInput) && flow.status !== "uncertain" && !flow.busy && !pending && <button type="button" className="btn" style={{ marginBottom: 14 }} onClick={() => { stopAudio(); flow.requestDiscardInput(); }}>저장되지 않은 입력 버리기</button>}
    {flow.discardingInput && <section className="card" role="alertdialog" aria-modal="false" aria-labelledby="discard-input-title" aria-describedby="discard-input-description" style={{ marginBottom: 14 }}>
      <h3 id="discard-input-title">저장되지 않은 입력을 버릴까요?</h3>
      <p id="discard-input-description">{flow.guided ? '화면에만 남아 있는 입력과 미저장 편집을 버리고 입력란을 비워요. 저장된 초안은 아래 목록에 그대로 보관하며 직접 다시 열 수 있어요.' : '화면에만 남아 있는 입력을 버려요. 편집 가능한 저장된 초안이 확인되면 그것을 표시하고, 그렇지 않으면 입력을 비워요.'} 지금의 미저장 입력은 복구할 수 없어요. 저장된 대화 기록은 삭제하지 않아요.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-danger" disabled={flow.busy} onClick={() => { stopAudio(); flow.confirmDiscardInput(); }}>현재 미저장 입력 버리기</button>
        <button type="button" className="btn" disabled={flow.busy} onClick={flow.cancelDiscardInput}>입력 유지</button>
      </div>
    </section>}

    {!session && <section className="card" aria-label="무료 회화 예문 미리보기" style={{ marginBottom: 14 }}>
      {practiceKind === 'guided' ? guidedPreview ? <>
        <h2>{guidedPreview.labelKo} · {guidedPreview.levelLabelKo}</h2>
        <p>{guidedPreview.situationKo}</p>
        <p>{guidedPreview.steps.length}단계 · 텍스트 전용 · 직접 작성한 고정 연습</p>
        <p>보내고 다음 단계로는 입력을 평가하지 않고 한 단계씩 진행해요. 점원 응답은 입력에 맞춰 바뀌지 않는 정해진 시범이에요. 마지막 전송 뒤에도 대화 종료는 직접 선택해요.</p>
        <p>{guidedPreview.completionNoteKo}</p>
        <p>현지 화자·전문가 검토 전의 직접 작성한 연습이에요. 수준 표시는 JLPT·CEFR 인증이 아니에요.</p>
      </> : <p>참고 자료만 있음 · 대화 준비 중</p> : <>
        <h2>{preview?.label} 예문 미리보기</h2>
        <p>기존 다섯 상황의 고정 예문이에요. 수준별 학습 과정은 아니에요.</p>
        {content && <><p lang="ja">{content.japanese}</p><p>{content.meaning}</p></>}
      </>}
      <p>저장 안내를 확인하고 ‘새 대화 시작’을 누르면 입력할 수 있어요.</p>
    </section>}

    {session && <section aria-label={session.closed ? "종료한 대화" : "진행 중인 대화"}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ flex: "1 1 180px" }}>{session.source.label} · {session.closed ? "종료한 대화" : "진행 중"}</h2>
        <button type="button" className="btn btn-danger" disabled={flow.busy || flow.status === "unsaved" || flow.status === "uncertain" || Boolean(pending)} onClick={() => { stopAudio(); flow.requestDelete(); }}>대화 삭제</button>
      </div>
      <p className="muted">시작: {sessionTime(session.createdAt, session.timeZone)} ({session.timeZone})</p>

      {flow.deletion && <section className="card" role="alertdialog" aria-modal="false" aria-labelledby="conversation-delete-title" aria-describedby="conversation-delete-description" style={{ marginBottom: 14 }}>
        <h3 id="conversation-delete-title">{flow.deletion.label} 대화를 영구 삭제할까요?</h3>
        <p>시작: {sessionTime(session.createdAt, session.timeZone)} ({session.timeZone}) · 보낸 문장 {session.turns.length}개</p>
        <p id="conversation-delete-description">이 브라우저에 저장된 이 대화의 보낸 문장, 초안, 보류 중 작업을 삭제해요. 복구할 수 없으며 다른 대화는 삭제하지 않아요. 확인하는 동안 기록이 바뀌면 다시 확인해야 해요.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-danger" disabled={flow.busy} onClick={() => { stopAudio(); void flow.confirmDelete(); }}>이 대화 영구 삭제</button>
          <button type="button" className="btn" disabled={flow.busy} onClick={flow.cancelDelete}>삭제 취소</button>
        </div>
      </section>}

      {flow.unsupported ? <section className="card" aria-label="이전 기준의 대화 원본" style={{ marginBottom: 14 }}>
        <h3>저장된 대화 원본 · 읽기 전용</h3>
        <p>잘 쓴 표현: 평가하지 않음 · 고칠 표현: 평가하지 않음</p>
        <p>예문 버전: {session.source.scriptRevision}</p>
        <p>응답 기준: {session.source.builderPolicy}</p>
        {'japanese' in session.source.content ? <><p lang="ja">{session.source.content.japanese}</p><p>{session.source.content.meaning}</p></> : <>
          <p>{session.source.levelId} · {session.source.content.situationKo}</p>
          {session.source.content.steps.map(step => <div key={step.id}><strong>{step.titleKo}</strong><p lang="ja">{step.learnerExample.japanese}</p><p>{step.learnerExample.meaningKo}</p></div>)}
        </>}
        {session.turns.length === 0 ? <p>이 원본에 저장된 전송 문장은 없어요.</p> : <ol style={{ paddingInlineStart: 24 }}>
          {session.turns.map(turn => <li key={turn.turnId} style={{ marginBottom: 16 }}>
            <strong>입력한 문장</strong>
            <p lang="ja" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{turn.draft.input}</p>
            <strong>당시 저장된 고정 응답 · 평가하지 않음</strong>
            <p lang="ja">{turn.emission.reply}</p>
            {settings.showReading && <p lang="ja">{turn.emission.replyReading}</p>}
            {settings.showKoreanPronunciation && <p className="muted">{turn.emission.replyKoreanPronunciation}</p>}
            <p>{turn.emission.explanation}</p>
          </li>)}
        </ol>}
      </section> : recap ? <ConversationSessionRecap recap={recap} /> : !session.closed ? <>
        {flow.guided ? <section className="card" aria-label="현재 연습 단계" style={{ marginBottom: 14 }}>
          <p>직접 작성한 고정 연습 · {'levelLabelKo' in session.source ? session.source.levelLabelKo : ''} · 텍스트 전용</p>
          <p>전송한 단계 {flow.progress?.submittedStepCount}/{flow.progress?.totalStepCount} · 입력은 평가하지 않아요.</p>
          <p>점원 응답은 입력에 맞춰 바뀌지 않는 정해진 시범이에요. 전송하면 문자열 일치 여부와 관계없이 한 단계 진행해요.</p>
          {'steps' in session.source.content && <><p>{session.source.content.situationKo}</p><p className="muted">{session.source.content.pronunciationNoteKo}</p></>}
          {activeStep ? <>
            <h3>{(flow.progress?.activeStepIndex ?? 0) + 1}. {activeStep.titleKo}</h3>
            <p>{activeStep.goalKo}</p>
            {activeStep.prompt && <div><strong>점원 말</strong><p lang="ja">{activeStep.prompt.japanese}</p><p>{activeStep.prompt.meaningKo}</p></div>}
            <strong>연습 예문</strong>
            <p lang="ja">{activeStep.learnerExample.japanese}</p>
            {settings.showReading && <p lang="ja">{activeStep.learnerExample.reading}</p>}
            {settings.showKoreanPronunciation && <p className="muted">{activeStep.learnerExample.koreanPronunciation}</p>}
            <p>{activeStep.learnerExample.meaningKo}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn" disabled={!editable || !flow.canSend || flow.busy} onClick={flow.insertExample}>예문 넣기</button>
              <button type="button" className="btn" aria-expanded={hintVisible} onClick={() => setHintTarget(hintVisible ? null : currentHintTarget)}>{hintVisible ? '힌트 숨기기' : '힌트 보기'}</button>
            </div>
            {hintVisible && <p>{activeStep.hintKo}</p>}
          </> : <p role="status">연습 단계 {flow.progress?.submittedStepCount}/{flow.progress?.totalStepCount} 전송됨 · 대화 종료로 기록을 마무리해 주세요.</p>}
          {flow.currentStepBlocked && <p role="alert">이전 단계의 초안 두 개가 저장되어 있어 다음 단계의 입력을 저장할 수 없어요. 초안을 그대로 보관하고 대화를 종료한 뒤 새 대화를 시작할 수 있어요. 새 대화는 첫 단계부터 시작하며 저장 한도가 적용돼요.</p>}
        </section> : content && <section className="card" aria-label="무료 회화 예문" style={{ marginBottom: 14 }}>
          <strong>{content.meaning}</strong>
          <p lang="ja">{content.japanese}</p>
          {settings.showReading && <p lang="ja">{content.reading}</p>}
          {settings.showKoreanPronunciation && <p className="muted">{content.pronunciation}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={!editable || flow.busy} onClick={flow.insertExample}>예문으로 연습하기</button>
            <button type="button" className="btn" disabled={!editable || Boolean(playingAudioKey)} onClick={() => void handleExampleAudio()}>{playingAudioKey ? "재생 중..." : "예문 듣기"}</button>
            {playingAudioKey && <button type="button" className="btn" onClick={stopAudio}>재생 중지</button>}
          </div>
          {audioError && <p role="alert">{audioError}</p>}
        </section>}

        <section aria-label="이 대화에서 보낸 문장" style={{ border: "1px solid #dce8dc", borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <h3>보낸 문장 {session.turns.length}개</h3>
          {session.turns.length === 0 ? <p className="muted">아직 보낸 문장이 없어요. 입력만 저장한 초안은 여기에 포함하지 않아요.</p> : <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {session.turns.map(turn => <li key={turn.turnId} style={{ marginBottom: 16 }}>
              <div style={{ border: "1px solid #cfd8ff", borderRadius: 10, background: "#f3f6ff", padding: 12, marginBottom: 8 }}>
                <strong>나</strong>
                <p lang="ja" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{turn.draft.input}</p>
              </div>
              <div style={{ border: "1px solid #d6e9d6", borderRadius: 10, background: "#f5faf5", padding: 12 }}>
                <strong>{'kind' in turn.emission ? '정해진 점원 응답 · 평가하지 않음' : '고정 연습 예문 · 평가하지 않음'}</strong>
                <p lang="ja">{turn.emission.reply}</p>
                {settings.showReading && <p lang="ja">{turn.emission.replyReading}</p>}
                {settings.showKoreanPronunciation && <p className="muted">{turn.emission.replyKoreanPronunciation}</p>}
                {'kind' in turn.emission && turn.emission.kind === 'guided-fixed-emission' && <>
                  <p>{turn.emission.replyMeaningKo}</p>
                  {turn.emission.exampleFallback && <div><strong>참고 예문</strong><p lang="ja">{turn.emission.exampleFallback.japanese}</p>
                    {settings.showReading && <p lang="ja">{turn.emission.exampleFallback.reading}</p>}
                    {settings.showKoreanPronunciation && <p>{turn.emission.exampleFallback.koreanPronunciation}</p>}
                    <p>{turn.emission.exampleFallback.meaningKo}</p></div>}
                  <p>{turn.emission.hintKo}</p>
                </>}
                <p>{turn.emission.explanation}</p>
              </div>
            </li>)}
          </ol>}
        </section>

        {flow.guided && flow.olderStepInput && <section className="card" aria-label="이전 단계의 보내지 않은 초안">
          <h3>이전 단계의 보내지 않은 초안 · {flow.editorStep?.titleKo ?? flow.editorStepRef?.stepId}</h3>
          <p>아래 입력은 이 단계의 초안으로 보존돼요. 현재 단계의 문장으로 바뀌거나 다시 전송되지 않아요.</p>
          {activeStep && <button type="button" className="btn" disabled={flow.busy || flow.currentStepBlocked || Boolean(pending)} onClick={() => void flow.openCurrentStep()}>저장하고 현재 단계 열기</button>}
        </section>}
        {flow.guided && !flow.editorStepRef && activeStep && <button type="button" className="btn" disabled={flow.busy || flow.currentStepBlocked || Boolean(pending)} onClick={() => void flow.openCurrentStep()}>현재 단계 열기</button>}
        {flow.laneBlocked && flow.input && <p role="alert">화면의 미저장 입력을 보존했어요. 두 저장 초안을 바꾸지 않으므로 이 입력을 저장할 수 없어요. 직접 보관한 뒤 미저장 입력을 버릴지 확인해야 종료할 수 있어요.</p>}
        <label htmlFor="conversation-input">{flow.olderStepInput ? '이전 단계 초안 입력' : '일본어 문장'}</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <input id="conversation-input" type="text" value={flow.input} disabled={!editable} aria-describedby="conversation-input-help"
            onChange={event => flow.typeInput(event.target.value)} onKeyDown={handleKeyDown}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            placeholder="일본어로 입력하세요" style={{ flex: "1 1 200px", minWidth: 0 }} />
          <button type="button" className="btn" disabled={!editable || !flow.canSend || flow.busy || !flow.input.trim() || overLimit || Boolean(pending)} onClick={handleSend}>{flow.guided ? flow.progress?.activeStepIndex === (flow.progress?.totalStepCount ?? 0) - 1 ? '마지막 문장 보내기' : '보내고 다음 단계로' : '전송'}</button>
        </div>
        <p id="conversation-input-help" className="muted">최대 8,000자(UTF-16 단위). 한도를 넘긴 입력도 지우지 않고 그대로 남겨요.{flow.guided && " Enter도 위 전송 버튼과 같이 보내고 다음 단계로 진행해요. 한글·일본어 조합 중 Enter는 전송하지 않아요."}</p>
        {overLimit && <p role="alert">8,000자 한도를 넘겨 저장하거나 전송할 수 없어요. 입력은 그대로 남아 있으니 직접 줄여 주세요.</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <button type="button" className="btn" disabled={!editable || flow.busy || overLimit} onClick={() => void flow.save()}>입력 저장</button>
          <button type="button" className="btn" disabled={!flow.canClose || overLimit} onClick={() => { stopAudio(); void flow.end(); }}>{flow.guided ? flow.currentStepBlocked ? '현재 기록으로 대화 종료' : '대화 종료' : '대화 끝내기'}</button>
        </div>
        <p className="muted">대화를 끝내면 보낸 문장만 종료 요약에 포함해요. 남은 입력은 보내지 않은 초안으로 따로 보관해요.</p>
      </> : <p role="status">종료한 대화의 저장 기준을 확인하지 못했어요.</p>}

      {session.drafts.some(draft => draft.input.trim()) && <section className="card" aria-label="보내지 않은 초안" style={{ marginBlock: 14 }}>
        <h3>보내지 않은 초안</h3>
        <p className="muted">저장된 초안은 보낸 문장이 아니에요. 보류 전송에 묶인 초안은 결과 확인이나 취소 후 편집할 수 있어요.</p>
        {session.drafts.filter(draft => draft.input.trim()).map((draft, index) => <div key={draft.draftId} style={{ borderTop: "1px solid #ddd", paddingBlock: 10 }}>
          <strong>초안 {index + 1}{'steps' in session.source.content && ` · ${session.source.content.steps.find(step => step.id === draft.source.stepId)?.titleKo ?? draft.source.stepId} · ${draft.source.stepId === flow.progress?.activeStepId ? '현재 단계의 보내지 않은 초안' : '이전 단계의 보내지 않은 초안'}`}</strong>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{draft.input}</p>
          {!session.closed && !flow.unsupported && <button type="button" className="btn" disabled={flow.busy} onClick={() => { stopAudio(); void flow.selectDraft(draft.draftId); }}>이 초안 열기</button>}
        </div>)}
      </section>}
    </section>}

    {!session && <section className="card" aria-label="이 브라우저의 대화 기록">
      <h2>이 브라우저의 대화 기록</h2>
      {flow.missing ? <p role="alert">이 브라우저의 기존 대화 저장 원본을 확인하지 못했어요. 기록이 비어 있다고 판단하거나 새 저장소를 자동으로 만들지 않아요. 저장 상태를 다시 확인해 주세요.</p> : flow.sessions.length === 0 ? <p>저장된 대화가 없어요.</p> : <ul style={{ listStyle: "none", padding: 0 }}>
        {history.map(item => {
          const unsent = item.drafts.filter(draft => draft.input.trim()).length;
          const unresolved = item.operations.some(operation => operation.terminal === null);
          return <li key={item.sessionId} style={{ borderTop: "1px solid #ddd", paddingBlock: 12 }}>
            <strong>{item.source.label} · {'levelLabelKo' in item.source ? `${item.source.levelLabelKo} · 직접 작성한 고정 연습` : '기존 고정 예문 · 수준 미지정'} · {item.closed ? "종료됨" : "진행 중"}</strong>
            {'steps' in item.source.content && <p>전송한 단계 {item.turns.length}/{item.source.content.steps.length}</p>}
            <p className="muted">예문 버전: {item.source.scriptRevision}</p>
            <p>{sessionTime(item.createdAt, item.timeZone)} ({item.timeZone}) · 보낸 문장 {item.turns.length}개 · 보내지 않은 초안 {unsent}개</p>
            {unresolved && <p>저장 확인 필요 · 보류 중인 작업이 있어요.</p>}
            <button type="button" className="btn" aria-label={`${item.source.label} ${sessionTime(item.createdAt, item.timeZone)} ${item.closed ? "종료 요약 보기" : "대화 이어가기"}`} disabled={flow.busy} onClick={() => { stopAudio(); void flow.open(item.sessionId); }}>{item.source.label} {item.closed ? "종료 요약 보기" : "대화 이어가기"}</button>
          </li>;
        })}
      </ul>}
    </section>}
  </section>;
}

function LegacyPaidConversationPage() {
  const [situation, setSituation] = useState<Situation>("일상");
  const { records, snapshot, error: recordError } = useLanguageRecordSnapshot();
  const settingsError = languageSettingsProjectionError({ japaneseAppSettings: records.japaneseAppSettings });
  const settings = loadJapaneseAppSettings(records.japaneseAppSettings).sections.conversation;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingAudioKey, setPlayingAudioKey] = useState<string | null>(null);
  const lastFreeSendMessages = useRef<ChatMessage[] | null>(null);
  const audioRequest = useRef<AbortController | null>(null);
  useEffect(() => () => audioRequest.current?.abort(), []);



  const handleSend = async () => {
    const text = input.trim();
    if (!text) return; // 빈 입력 전송 방지
    if (loading) return; // 로딩 중 중복 전송 방지

    if (FREE_MODE) {
      // Ignore repeated sends from the same render until the new messages commit.
      if (lastFreeSendMessages.current === messages) return;
      try {
        const practice = buildFreeConversation(situation, text);
        const practiceMsg: ChatMessage = {
          role: "assistant",
          reply: practice.reply,
          replyReading: practice.replyReading,
          replyKoreanPronunciation: practice.replyKoreanPronunciation,
          correction: practice.correction,
          correctionReading: practice.correctionReading,
          correctionKoreanPronunciation: practice.correctionKoreanPronunciation,
          explanation: practice.explanation,
          originalUserText: text,
        };
        lastFreeSendMessages.current = messages;
        setMessages([...messages, { role: "user", text }, practiceMsg]);
        setInput("");
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "알 수 없는 오류");
      }
      return;
    }

    // 사용자 메시지 먼저 화면에 추가
    const userMsg: ChatMessage = { role: "user", text };
    const nextMessages: ChatMessage[] = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/language/conversation", {
        method: "POST",
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify({
          situation,
          message: text,
          history: messages, // 이전 대화 맥락 전달
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          (data && (data as { error?: string }).error) ||
          `응답을 받지 못했습니다. (status ${res.status})`;
        throw new Error(msg);
      }

      const ai = data as {
        reply?: string;
        replyReading?: string;
        replyRubySegments?: RubySegment[];
        replyKoreanPronunciation?: string;
        correction?: string;
        correctionReading?: string;
        correctionRubySegments?: RubySegment[];
        correctionKoreanPronunciation?: string;
        explanation?: string;
      };

      const aiMsg: ChatMessage = {
        role: "assistant",
        reply: ai.reply ?? "",
        replyReading: ai.replyReading ?? "",
        replyRubySegments: ai.replyRubySegments,
        replyKoreanPronunciation: ai.replyKoreanPronunciation ?? "",
        correction: ai.correction ?? "",
        correctionReading: ai.correctionReading ?? "",
        correctionRubySegments: ai.correctionRubySegments,
        correctionKoreanPronunciation: ai.correctionKoreanPronunciation ?? "",
        explanation: ai.explanation ?? "",
        originalUserText: text,
      };
      setMessages([...nextMessages, aiMsg]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // IME 한글/일본어 조합 중에는 전송 안 함
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229 && !e.repeat) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleReset = () => {
    if (loading) return;
    setMessages([]);
    setError(null);
  };

  const isCorrectionDifferent = (original: string, corrected: string) =>
    corrected.trim() !== "" && corrected.trim() !== original.trim();

  const getSafeText = (value: unknown) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed === "0") return "";
    if (trimmed.includes("한글 발음 참고를 생성하지 못했습니다")) return "";
    return trimmed;
  };


  const handleSpeak = async (text: string, audioKey: string) => {
    if (!text || playingAudioKey) return;
    audioRequest.current?.abort();
    const request = new AbortController();
    audioRequest.current = request;
    setError(null);
    setPlayingAudioKey(audioKey);
    try {
      await speakJapaneseWithPreferredTts(text, { rate: settings.ttsRate, repeatCount: settings.repeatCount, repeatDelayMs: settings.repeatDelayMs, signal: request.signal });
    } catch (error) {
      setError(japaneseAudioErrorMessage(error));
    } finally {
      setPlayingAudioKey(null);
    }
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "#7b8c7b",
    marginBottom: "4px",
    letterSpacing: "0.01em",
  };

  const sectionDividerStyle: React.CSSProperties = {
    marginTop: "10px",
    paddingTop: "10px",
    borderTop: "1px solid #dce8dc",
  };

  if (!snapshot) return <section role="status">{recordError || "학습 기록의 저장 상태를 확인하고 있어요."}</section>;

  return (
    <section>
      {settingsError && <p role="alert">{settingsError}</p>}
      <div className="page-header">
        <h1>{FREE_MODE ? "상황별 회화 연습" : "AI 회화"}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {FREE_MODE ? "무료 예문과 기기 음성으로 연습해요. 자유 문장 교정과 발음 채점은 하지 않아요." : "상황을 선택하고 일본어로 대화를 연습해 보세요."}
        </p>
      </div>

      {/* 1) 상황 선택 영역 (상단 분리) */}
      <div className="card" style={{ marginBottom: "14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <label
            htmlFor="situation"
            style={{ fontSize: "13px", color: "#555" }}
          >
            상황
          </label>
          <select
            id="situation"
            value={situation}
            onChange={(e) => { setSituation(e.target.value as Situation); setMessages([]); setError(null); }}
            disabled={loading}
          >
            {SITUATIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={handleReset}
            disabled={loading || messages.length === 0}
            className="btn btn-danger"
            style={{ marginLeft: "auto" }}
          >
            대화 초기화
          </button>
        </div>
      </div>

      {FREE_MODE ? <section className="card" aria-label="무료 회화 예문" style={{ marginBottom: 14 }}>
        <strong>{FREE_CONVERSATIONS[situation].meaning}</strong>
        <p lang="ja">{FREE_CONVERSATIONS[situation].japanese}</p>
        {settings.showReading ? <p lang="ja">{FREE_CONVERSATIONS[situation].reading}</p> : null}
        {settings.showKoreanPronunciation ? <p className="muted">{FREE_CONVERSATIONS[situation].pronunciation}</p> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" disabled={loading} onClick={() => setInput(FREE_CONVERSATIONS[situation].japanese)}>예문으로 연습하기</button>
          <button className="btn" disabled={Boolean(playingAudioKey)} onClick={() => void handleSpeak(FREE_CONVERSATIONS[situation].japanese, "example")}>예문 듣기</button>
        </div>
      </section> : null}

      {/* 2) 대화 영역 (학습용 채팅 박스) */}
      <div
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: "10px",
          background: "#fafafa",
          padding: "12px",
          minHeight: "280px",
          maxHeight: "520px",
          overflowY: "auto",
          marginBottom: "12px",
        }}
      >
        {messages.length === 0 && !loading && !error ? (
          <div
            style={{
              textAlign: "center",
              color: "#888",
              fontSize: "14px",
              padding: "40px 8px",
            }}
          >
            아직 대화가 없습니다.
            <br />
            일본어로 메시지를 입력해 보세요.
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {messages.map((m, idx) => {
              if (m.role === "user") {
                // 사용자 메시지: 오른쪽 정렬 말풍선
                return (
                  <li
                    key={idx}
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      margin: "8px 0",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "80%",
                        border: "1px solid #cfd8ff",
                        borderRadius: "12px",
                        padding: "10px 12px",
                        background: "#f3f6ff",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#6b7ab0",
                          marginBottom: "2px",
                        }}
                      >
                        나
                      </div>
                      <div style={{ fontSize: "15px" }}>{m.text}</div>
                    </div>
                  </li>
                );
              }

              const replyText = getSafeText(m.reply);
              const correctionText = getSafeText(m.correction);
              const correctedKoreanPronunciation = getSafeText(m.correctionKoreanPronunciation);
              const hasCorrection = correctionText.length > 0;
              const corrected = hasCorrection && isCorrectionDifferent(
                m.originalUserText,
                correctionText
              );

              // AI 메시지: 왼쪽 정렬, 답변/교정/설명 섹션 구분
              return (
                <li
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "flex-start",
                    margin: "8px 0",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "90%",
                      border: "1px solid #d6e9d6",
                      borderRadius: "12px",
                      padding: "14px 14px",
                      background: "#f5faf5",
                      lineHeight: 1.6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#5e8f5e",
                        marginBottom: "6px",
                      }}
                    >
                        {FREE_MODE ? "고정 연습 예문 · 평가하지 않음" : "AI"}
                    </div>

                    {/* 1) AI 답변 */}
                    <div>
                      <div style={sectionLabelStyle}>답변</div>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => handleSpeak(m.reply, `reply-${idx}`)}
                        disabled={!m.reply || playingAudioKey !== null}
                        style={{ marginBottom: "8px", fontSize: "12px", padding: "4px 8px" }}
                      >
                        {playingAudioKey === `reply-${idx}` ? "재생 중..." : "🔊 답변 듣기"}
                      </button>
                      <div
                        style={{
                          fontSize: "16px",
                          fontWeight: 700,
                          color: "#223322",
                          lineHeight: 1.55,
                        }}
                      >
                        {!settings.showReading || !/[\u3400-\u9FFF]/.test(m.reply || "") || !m.replyRubySegments?.length
                          ? (replyText || "—")
                          : m.replyRubySegments.map((segment, index) => (
                            segment.reading ? <ruby key={`${segment.text}-${index}`} style={{ rubyPosition: "over", rubyAlign: "center" }}>{segment.text}<rt style={{ fontSize: "0.58em", color: "#7b8c7b" }}>{segment.reading}</rt></ruby> : <span key={`${segment.text}-${index}`}>{segment.text}</span>
                          ))}
                      </div>
                    </div>
                    {settings.showKoreanPronunciation && m.replyKoreanPronunciation && (
                      <div style={{ marginTop: "2px", color: "#728172", fontSize: "12px", lineHeight: 1.5, wordBreak: "break-word" }}>
                        {m.replyKoreanPronunciation}
                      </div>
                    )}

                    {/* 4) 교정 */}
                    {hasCorrection ? (
                      <div style={sectionDividerStyle}>
                        <div style={sectionLabelStyle}>
                          교정 {corrected ? "(수정됨)" : "(자연스러움)"}
                        </div>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => handleSpeak(correctionText, `correction-${idx}`)}
                          disabled={!hasCorrection || playingAudioKey !== null}
                          style={{ marginBottom: "8px", fontSize: "12px", padding: "4px 8px" }}
                        >
                          {playingAudioKey === `correction-${idx}` ? "재생 중..." : "🔊 교정 듣기"}
                        </button>
                        <div
                          style={{
                            color: "#233223",
                            fontSize: "15px",
                            fontWeight: 600,
                            lineHeight: 1.55,
                          }}
                        >
                          {!settings.showReading || !/[\u3400-\u9FFF]/.test(m.correction || "") || !m.correctionRubySegments?.length
                            ? correctionText
                            : m.correctionRubySegments.map((segment, index) => (
                              segment.reading ? <ruby key={`${segment.text}-${index}`} style={{ rubyPosition: "over", rubyAlign: "center" }}>{segment.text}<rt style={{ fontSize: "0.58em", color: "#7b8c7b" }}>{segment.reading}</rt></ruby> : <span key={`${segment.text}-${index}`}>{segment.text}</span>
                            ))}
                        </div>
                      </div>
                    ) : null}
                    {settings.showKoreanPronunciation && hasCorrection && correctedKoreanPronunciation && (
                      <div style={{ marginTop: "2px", color: "#728172", fontSize: "12px", lineHeight: 1.5, wordBreak: "break-word" }}>
                        {correctedKoreanPronunciation}
                      </div>
                    )}

                    {/* 7) 설명 */}
                    {m.explanation && (
                      <div style={sectionDividerStyle}>
                        <div style={sectionLabelStyle}>설명</div>
                        <div
                          style={{ color: "#4c5d4c", fontSize: "14px", lineHeight: 1.6 }}
                        >
                          {m.explanation}
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {loading && (
          <p
            className="muted"
            style={{ marginTop: "8px", textAlign: "center" }}
          >
            {FREE_MODE ? "연습 문장을 준비하고 있어요…" : "AI가 응답 중..."}
          </p>
        )}
        {error && (
          <p
            role="alert"
            style={{
              color: "#c00",
              marginTop: "8px",
              padding: "8px",
              border: "1px solid #f2caca",
              borderRadius: "8px",
              background: "#fff4f4",
            }}
          >
            에러: {error}
          </p>
        )}
      </div>

      {/* 3) 입력 영역 */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            loading ? "응답을 준비하고 있어요…" : "일본어로 입력하세요"
          }
          disabled={loading}
          style={{ flex: 1 }}
        />
        <button
          onClick={handleSend}
          disabled={loading || input.trim() === ""}
          className="btn"
        >
          {loading ? "전송 중..." : "전송"}
        </button>
      </div>
    </section>
  );
}
