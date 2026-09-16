"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CurriculumLesson } from "@/data/curriculum";
import { getQuestionChoices, isTypedAnswerCorrect, type LearnerMode } from "@/utils/learningSession";
import { reviewModality, type ReviewObservation } from '@/utils/learningReview';
import LearningCompanion from "./LearningCompanion";
import styles from "./learning-focus.module.css";

export default function LearningQuestion({ lesson, index, mode, answer, response, onAnswer, onRetry, onHint, play, playing, showCompanion = true }: {
  lesson: CurriculumLesson; index: number; mode: LearnerMode; answer?: boolean; response?: string;
  onAnswer: (correct: boolean, response: string, observation: ReviewObservation) => void; onRetry: () => void;
  onHint?: () => void;
  play: (text: string) => void; playing: boolean;
  showCompanion?: boolean;
}) {
  const quiz = lesson.quiz[index];
  const [typed, setTyped] = useState(response ?? "");
  const inputId = useId();
  const [showHint, setShowHint] = useState(false);
  const usedHint = useRef(false);
  const clock = useRef({ elapsed: 0, started: 0 });
  useEffect(() => {
    const now = () => performance.now();
    clock.current = { elapsed: 0, started: answer === undefined && !document.hidden ? now() : 0 };
    const visibility = () => { const time = now(); if (clock.current.started) clock.current.elapsed += time - clock.current.started; clock.current.started = !document.hidden && answer === undefined ? time : 0; };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [index, answer]);
  const submit = (correct: boolean, value: string) => onAnswer(correct, value, { responseMs: clock.current.elapsed + (clock.current.started ? performance.now() - clock.current.started : 0), neededHelp: usedHint.current, modality: reviewModality(quiz.kind, mode) });
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (answer !== undefined) feedbackRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [answer]);
  const prompt = mode === "starter" ? quiz.prompt.replace("日本語", "일본어").replace("일본어로 입력하세요.", "뜻에 맞는 일본어를 골라요.") : quiz.prompt;
  return <div>
    <h3>{prompt}</h3>
    {quiz.kind === "listening" && <div className={styles.row}><button type="button" disabled={playing} onClick={() => play(quiz.choices[quiz.answer])}>▶ 문제 소리 듣기</button></div>}
    {quiz.kind === "input" && mode === "reader" ? <form onSubmit={(event) => { event.preventDefault(); if (typed.trim() && answer === undefined) submit(isTypedAnswerCorrect(lesson, index, typed), typed); }}>
      <label htmlFor={inputId}>일본어로 써 보세요. 읽는 법으로 입력해도 괜찮아요.</label>
      <input id={inputId} className={styles.input} value={typed} disabled={answer !== undefined} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
      <div className={styles.row}><button type="submit" disabled={!typed.trim() || answer !== undefined}>답 확인하기</button></div>
    </form> : <div className={styles.choices}>
      {getQuestionChoices(lesson, index, mode).map((choice) => <button type="button" key={choice.label} className={styles.choice}
        disabled={answer !== undefined} data-result={answer !== undefined && choice.label === response ? answer ? "correct" : "wrong" : undefined}
        onClick={() => submit(choice.correct, choice.label)}>{choice.label === response && answer !== undefined ? answer ? "✓ " : "↻ " : ""}{choice.label}</button>)}
    </div>}
    {answer === undefined && <div className={styles.row}><button type="button" onClick={() => { if (!showHint) { usedHint.current = true; onHint?.(); } setShowHint((value) => !value); }}>{showHint ? "힌트 접기" : "힌트 볼래요"}</button></div>}
    {showHint && answer === undefined && <p className={styles.feedback}>{quiz.explanation}</p>}
    {answer !== undefined && <div ref={feedbackRef} className={styles.feedback} data-correct={answer} role="status">
      <LearningCompanion hidden={!showCompanion} action={answer ? "celebrate" : "encourage"} motionKey={`${lesson.id}:${index}`}>
        <strong>{answer ? "맞았어요! 하나 더 익혔네요." : "괜찮아요. 설명을 보고 다시 해 봐요."}</strong>
      </LearningCompanion>
      {response && <p>내가 고른 답: {response}</p>}<p>{quiz.explanation}</p>
      {!answer && <div className={styles.row}><button type="button" onClick={() => { setTyped(""); setShowHint(false); onRetry(); }}>다시 풀어볼래요</button></div>}
    </div>}
  </div>;
}
