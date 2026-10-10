'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { CapturedCourseReviewAdapter, capturedReviewAvailable, isCapturedReviewVisible, type CapturedLegacyActions, type CapturedReviewView } from '@/app/data/languageLegacyReviewCapture';
import type { LanguageRecordContext, LanguageRecordSnapshot } from '@/app/data/languageCloudSync';
import type { LanguageRowHandle } from '@/app/data/languageRecordIdentity';
import { getQuestionChoices, type LearnerMode } from '@/utils/learningSession';
import type { ReviewObservation } from '@/utils/learningReview';
import styles from './learning-focus.module.css';

type Source = { context: LanguageRecordContext | null; snapshot: LanguageRecordSnapshot | null };
type Draft = { token: string | null; answer: string; feedback: { eventId: string; correct: boolean; observation: ReviewObservation } | null; hint: boolean };
const EMPTY: CapturedReviewView = { status: 'idle', busy: false, revision: 0, failure: null, showQuestion: false, showHint: false, handoff: null, draftToken: null, runId: null, delivery: 'none' };
const failures = { unavailable: '기록을 확인하지 못했어요. 입력은 보존했어요.', source_changed: '원래 복습 기록이나 연결이 바뀌었어요. 입력을 유지한 채 멈췄어요.', interrupted: '화면이 중단되어 관찰을 확인하지 못했어요. 입력은 보존했어요.', shared_exposure: '다른 화면에서 같은 표현을 봤어요. 이 입력의 기록은 안전하게 중단했어요.', unsupported_value: '이 입력이나 풀이 시간은 현재 기록 범위를 넘어요. 입력을 줄이거나 바꾸지 않고 보존했어요.', uncertain_retirement: '복습 저장 결과를 아직 확정하지 못했어요. 새 저장을 만들지 말고 같은 저장을 확인해 주세요.' } as const;

/** Controlled question. It never mounts the ordinary immediate-reveal question. */
export default function CapturedCourseReviewQuestion({ handle, mode, source, actions, onPin, onClosed }: {
  handle: LanguageRowHandle; mode: LearnerMode; source: Source; actions: CapturedLegacyActions; onPin: () => void; onClosed: () => void;
}) {
  const live = useRef({ source, actions, onPin, onClosed }); live.current = { source, actions, onPin, onClosed };
  const adapter = useRef<CapturedCourseReviewAdapter | null>(null), mounted = useRef(true), inFlight = useRef(false), composing = useRef(false);
  const [view, setView] = useState<CapturedReviewView>(EMPTY), [draft, setDraft] = useState<Draft>({ token: null, answer: '', feedback: null, hint: false });
  const [startFailure, setStartFailure] = useState(false);
  const container = useRef<HTMLElement>(null);
  const question = useRef<HTMLDivElement>(null), hint = useRef<HTMLParagraphElement>(null), feedback = useRef<HTMLDivElement>(null);
  const inputId = useId(), observedEffect = useRef(''), publicationEffect = useRef(''), closedEffect = useRef('');
  const timerToken = useRef<string | null>(null);
  const timer = useRef<{ started: number; elapsed: number; hint: boolean }>({ started: 0, elapsed: 0, hint: false });
  useEffect(() => {
    mounted.current = true;
    const stop = () => { if (timer.current.started) { timer.current.elapsed += performance.now() - timer.current.started; timer.current.started = 0; } adapter.current?.suspend(); };
    const visibility = () => { if (document.visibilityState !== 'visible' || !document.hasFocus()) stop(); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', stop); window.addEventListener('pagehide', stop);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', stop); window.removeEventListener('pagehide', stop); adapter.current?.dispose(); };
  }, []);
  useEffect(() => {
    const stop = () => adapter.current?.suspend(); const signal = source.context?.signal;
    signal?.addEventListener('abort', stop);
    if (adapter.current && (!source.context || !source.snapshot)) stop();
    return () => signal?.removeEventListener('abort', stop);
  }, [source.context, source.snapshot]);
  const perform = async (work: () => Promise<boolean>) => {
    if (inFlight.current || !mounted.current) return;
    inFlight.current = true;
    try { await work(); } finally { inFlight.current = false; }
  };
  const start = () => perform(async () => {
    if (!capturedReviewAvailable() || !source.context || !source.snapshot || adapter.current) return false;
    try {
      const instance = new CapturedCourseReviewAdapter({ handle, mode, source: () => live.current.source,
        actions: { submit: (...args) => live.current.actions.submit(...args), retry: () => live.current.actions.retry() },
        changed: value => { if (mounted.current) setView(value); } });
      adapter.current = instance; live.current.onPin(); return await instance.start();
    } catch { setStartFailure(true); return false; }
  });
  const effectCurrent = useCallback((expected: CapturedReviewView) => {
    const instance = adapter.current, element = container.current;
    return mounted.current && Boolean(live.current.source.snapshot) && Boolean(instance?.isCurrentView(expected)) &&
      Boolean(element?.isConnected) && !element?.closest('[hidden], [inert], [aria-hidden="true"]') &&
      document.visibilityState === 'visible' && document.hasFocus();
  }, []);
  // First publish into React state. A later effect acknowledges the committed render.
  useEffect(() => {
    if (!effectCurrent(view) || !view.runId || !view.draftToken || view.status === 'closed') return;
    if (view.status === 'retry_pending') {
      setDraft({ token: view.draftToken, answer: '', feedback: null, hint: false }); return;
    }
    if (view.handoff && view.handoff.draftToken === view.draftToken) {
      setDraft({ token: view.draftToken, answer: view.handoff.answer, feedback: { eventId: view.handoff.eventId, correct: view.handoff.correct, observation: view.handoff.observation }, hint: view.showHint });
    } else setDraft(current => ({ ...current, token: view.draftToken, hint: view.showHint }));
  }, [view, effectCurrent]);
  useEffect(() => {
    const instance = adapter.current; if (!instance || !effectCurrent(view) || view.busy || !view.runId) return;
    if (view.status === 'closed') { if (closedEffect.current !== view.runId) { closedEffect.current = view.runId; live.current.onClosed(); } return; }
    if (!view.draftToken || draft.token !== view.draftToken) return;
    if (view.status === 'retry_pending' && draft.answer === '' && !draft.hint && !draft.feedback) {
      const key = `clear:${view.runId}:${draft.token}`; if (publicationEffect.current === key) return; publicationEffect.current = key;
      void instance.cleared({ runId: view.runId, draftToken: draft.token!, answer: '', hintShown: false, feedbackShown: false }); return;
    }
    if (view.status === 'feedback_pending' && draft.feedback && view.handoff?.status === 'pending' && draft.answer === view.handoff.answer && draft.feedback.eventId === view.handoff.eventId) {
      const key = `publish:${view.runId}:${draft.feedback.eventId}`; if (publicationEffect.current === key) return; publicationEffect.current = key;
      void instance.published({ runId: view.runId, draftToken: draft.token!, eventId: draft.feedback.eventId, answer: draft.answer, correct: draft.feedback.correct, observation: draft.feedback.observation });
    }
  }, [view, draft, effectCurrent]);
  useEffect(() => {
    const instance = adapter.current; if (!instance || !effectCurrent(view) || view.busy || !view.runId) return;
    const surface = view.status === 'question_pending' ? 'question' : view.status === 'hint_pending' && draft.hint ? 'hint' : view.status === 'feedback_pending' && draft.feedback && view.handoff?.status === 'applied' ? 'feedback' : null;
    const element = surface === 'question' ? question.current : surface === 'hint' ? hint.current : feedback.current;
    if (!surface || !element) return;
    const key = `${surface}:${view.runId}:${view.draftToken}:${view.handoff?.eventId ?? ''}`;
    if (observedEffect.current === key) return; observedEffect.current = key;
    void instance.observe(surface, element).then(success => { if (success && adapter.current === instance && effectCurrent(instance.view()) && surface === 'question') timer.current.started = performance.now(); });
  }, [view, draft, effectCurrent]);
  useEffect(() => {
    if (effectCurrent(view) && view.status === 'ready' && !view.busy && view.draftToken && document.visibilityState === 'visible' && document.hasFocus()) {
      if (timerToken.current !== view.draftToken) {
        timerToken.current = view.draftToken;
        timer.current = { started: performance.now(), elapsed: 0, hint: timer.current.hint };
      } else if (!timer.current.started) timer.current.started = performance.now();
    }
  }, [view, effectCurrent]);
  const available = capturedReviewAvailable(), instance = adapter.current, surface = instance?.surface;
  const canAnswer = view.status === 'ready' && !view.busy && !inFlight.current;
  const submit = (answer: string) => {
    if (!effectCurrent(view) || !canAnswer || composing.current || !question.current || !isCapturedReviewVisible(question.current)) return;
    void perform(async () => {
      const responseMs = timer.current.elapsed + (timer.current.started ? performance.now() - timer.current.started : 0);
      return instance!.answer(answer, { responseMs, neededHelp: timer.current.hint, modality: surface!.identity.taskFormat === 'typed_answer' ? 'typing' : 'meaning' });
    });
  };
  const recover = () => perform(async () => {
    publicationEffect.current = ''; observedEffect.current = '';
    return instance ? instance.recover() : false;
  });
  if (!available) return <section aria-label="기록형 과정 복습"><p role="status">기록형 과정 복습은 아직 활성화되지 않았어요.</p><Link href="/language/review">기존 복습으로 가기</Link></section>;
  return <section ref={container} className={styles.focus} aria-label="기록형 과정 복습">
    <p className={styles.kicker}>선택한 과정 문제 · 기록형 복습</p>
    {!view.showQuestion && view.status !== 'closed' && <p>시작을 누른 뒤 기록 연결을 확인하고 문제를 보여 드려요.</p>}
    {!instance && <button type="button" disabled={view.busy || !source.snapshot} onClick={() => void start()}>기록형 복습 시작</button>}
    {startFailure && <p role="alert">이 문제는 기록형 복습에서 지원하지 않거나 원본이 바뀌었어요.</p>}
    {view.failure && <p role="alert">{failures[view.failure]}</p>}
    {view.showQuestion && surface && <div className={styles.card}>
      <div ref={question} data-review-run={view.runId} data-review-draft={view.draftToken} data-review-surface="question"><h3>{surface.authored.question.prompt}</h3>
      {surface.identity.taskFormat === 'typed_answer' ? <form onSubmit={event => { event.preventDefault(); if (!composing.current && draft.answer.trim()) submit(draft.answer); }}>
        <label htmlFor={inputId}>일본어로 써 보세요. 읽는 법으로 입력해도 괜찮아요.</label>
        <input id={inputId} className={styles.input} autoComplete="off" autoCapitalize="none" spellCheck={false} value={draft.answer} disabled={!canAnswer}
          onChange={event => { if (canAnswer && !inFlight.current) setDraft(current => ({ ...current, answer: event.target.value })); }}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
        <button type="submit" disabled={!canAnswer || !draft.answer.trim()}>답 확인하기</button>
      </form> : <div className={styles.choices}>{getQuestionChoices(surface.lesson, surface.index, surface.mode).map(choice => <button type="button" key={choice.label} className={styles.choice} disabled={!canAnswer} onClick={() => submit(choice.label)}>{choice.label}</button>)}</div>}
      </div>
      {!draft.feedback && !draft.hint && <button type="button" disabled={!canAnswer} onClick={() => void perform(async () => { const success = await instance!.hint(); if (success) timer.current.hint = true; return success; })}>힌트 볼래요</button>}
      {draft.hint && <p ref={hint} data-review-run={view.runId} data-review-draft={view.draftToken} data-review-surface="hint" className={styles.feedback}>{surface.authored.question.explanation}</p>}
      {draft.feedback && <div className={styles.feedback} role="status">
        <strong>{draft.feedback.correct ? '맞았어요.' : '설명을 보고 다시 해 봐요.'}</strong><p>내가 고른 답: {draft.answer}</p><p ref={feedback} data-review-run={view.runId} data-review-draft={view.draftToken} data-review-event={draft.feedback.eventId} data-review-surface="feedback">{surface.authored.question.explanation}</p>
      </div>}
      {view.status === 'answered' && <div className={styles.row}>
        {!draft.feedback?.correct && <button type="button" disabled={view.busy} onClick={() => void perform(() => instance!.retryAnswer())}>다시 풀어볼래요</button>}
        {draft.feedback?.correct && <button type="button" disabled={view.busy} onClick={() => void perform(() => instance!.retire('schedule'))}>복습 결과 저장 · 다음 문제</button>}
      </div>}
      {['ready', 'answered'].includes(view.status) && <div className={styles.row}>
        <button type="button" disabled={view.busy} onClick={() => void perform(() => instance!.retire('defer'))}>내일 다시 볼래요</button>
        <button type="button" disabled={view.busy} onClick={() => { if (!inFlight.current && window.confirm('이 문제를 복습에서 삭제할까요? 수업 기록은 유지돼요.')) void perform(() => instance!.retire('delete', true)); }}>복습에서 삭제</button>
      </div>}
    </div>}
    {instance && ['blocked', 'retiring'].includes(view.status) && <button type="button" disabled={view.busy} onClick={() => void recover()}>같은 기록 다시 확인</button>}
    {instance && view.status === 'blocked' && view.failure !== 'uncertain_retirement' && <button type="button" disabled={view.busy} onClick={() => {
      if (!inFlight.current && window.confirm('기록형 복습을 종료할까요? 저장 여부가 불확실한 작업이 있으면 종료하지 않아요.')) void perform(() => instance.closeUnavailable(true));
    }}>기록형 복습 종료 확인</button>}
    {view.delivery !== 'none' && <p role="status">{view.delivery === 'verified' ? '서버에서 별도로 확인했어요.' : view.delivery === 'unavailable' ? '기록 저장과 서버 확인 상태를 아직 확인하지 못했어요.' : '로컬 기록이 있어요. 서버 확인은 대기 중이에요.'}</p>}
    {instance && view.delivery === 'pending' && ['ready', 'answered'].includes(view.status) && <button type="button" disabled={view.busy} onClick={() => void perform(() => instance.deliver())}>서버 기록 확인</button>}
    {view.status === 'closed' && <p role="status">복습 결과와 종료 기록을 확인했어요.</p>}
    <Link href="/language/review">기존 복습으로 이동</Link>
  </section>;
}
