"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CURRICULUM,
  TRACKS,
  getLesson,
  getTrackLessons,
  type CourseTrack,
} from "@/data/curriculum";
import {
  DEFAULT_CURRICULUM_PROGRESS,
  CURRICULUM_REVIEW_KEY,
  loadCurriculumProgress,
  saveCurriculumProgress,
  type CurriculumProgress,
  type CurriculumReviewItem,
} from "@/utils/curriculumProgress";
import { speakJapaneseWithPreferredTts } from "@/utils/speakJapanese";
import { getLocalDateKey } from "@/utils/dateKey";
import {
  DEFAULT_INTEGRATED_LEARNING_SETTINGS,
  loadIntegratedLearningSettings,
  type IntegratedLearningSettings,
} from "@/utils/integratedLearningSettings";

const trackOrder: CourseTrack[] = ["foundation", "work", "travel"];

function CurriculumContent() {
  const searchParams = useSearchParams();
  const lessonId = searchParams.get("lesson");
  const requestedTrack = searchParams.get("track");
  const [progress, setProgress] = useState<CurriculumProgress>(DEFAULT_CURRICULUM_PROGRESS);
  const [loaded, setLoaded] = useState(false);
  const [stage, setStage] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [inputAnswers, setInputAnswers] = useState<Record<number, string>>({});
  const [showReading, setShowReading] = useState(true);
  const [showDialogueText, setShowDialogueText] = useState(true);
  const [speakingChecks, setSpeakingChecks] = useState<boolean[]>([false, false, false]);
  const [settings, setSettings] = useState<IntegratedLearningSettings>(DEFAULT_INTEGRATED_LEARNING_SETTINGS);
  const [playingAudio, setPlayingAudio] = useState<"dialogue" | "slow" | "normal" | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  const selectedTrack: CourseTrack =
    requestedTrack === "work" || requestedTrack === "travel" || requestedTrack === "foundation"
      ? requestedTrack
      : progress.selectedTrack;
  const activeLesson = getLesson(lessonId);
  const isLessonMode = Boolean(lessonId);
  const lessons = useMemo(() => getTrackLessons(selectedTrack), [selectedTrack]);

  useEffect(() => {
    // 브라우저 전용 localStorage 기록은 마운트 후 복원합니다.
    const storedSettings = loadIntegratedLearningSettings();
    setProgress(loadCurriculumProgress());
    setSettings(storedSettings);
    setShowReading(storedSettings.showReading);
    setLoaded(true);
  }, []);

  useEffect(() => {
    // URL로 다른 수업을 열 때 플레이어 단계도 처음으로 되돌립니다.
    setStage(0);
    setAnswers({});
    setInputAnswers({});
    setSpeakingChecks([false, false, false]);
  }, [lessonId]);

  useEffect(() => () => {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  }, [recordingUrl]);

  const updateProgress = (next: CurriculumProgress) => {
    setProgress(next);
    saveCurriculumProgress(next);
  };

  const chooseTrack = (track: CourseTrack) => {
    updateProgress({ ...progress, selectedTrack: track });
  };

  const playJapanese = async (
    text: string,
    audioKey: "dialogue" | "slow" | "normal",
    rate: number,
    repeatCount = 1,
  ) => {
    if (playingAudio) return;
    setPlayingAudio(audioKey);
    try {
      await speakJapaneseWithPreferredTts(text, {
        rate,
        repeatCount,
        repeatDelayMs: repeatCount > 1 ? 650 : 0,
      });
    } finally {
      setPlayingAudio(null);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingError("이 브라우저에서는 녹음을 지원하지 않아요. 음성을 듣고 직접 따라 말해 주세요.");
      return;
    }
    try {
      setRecordingError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const url = URL.createObjectURL(new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        setRecordingUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
        setIsRecording(false);
        stream.getTracks().forEach((track) => track.stop());
      };
      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setRecordingError("마이크 권한을 허용하면 내 발음을 녹음해 다시 들을 수 있어요.");
    }
  };

  useEffect(() => {
    if (stage !== 2 || !settings.autoPlayDialogue) return;
    let cancelled = false;
    setPlayingAudio("dialogue");
    void speakJapaneseWithPreferredTts(activeLesson.dialogue.map((line) => line.japanese).join(" "), { rate: settings.audioRate })
      .finally(() => { if (!cancelled) setPlayingAudio(null); });
    return () => { cancelled = true; };
  }, [activeLesson, settings.audioRate, settings.autoPlayDialogue, stage]);

  const finishLesson = () => {
    const correct = activeLesson.quiz.filter((quiz, index) => answers[index] === quiz.answer).length;
    const score = Math.round((correct / activeLesson.quiz.length) * 100);
    const completedAt = new Date().toISOString();
    updateProgress({
      ...progress,
      selectedTrack: activeLesson.track,
      completedLessonIds: Array.from(new Set([...progress.completedLessonIds, activeLesson.id])),
      quizScores: { ...progress.quizScores, [activeLesson.id]: score },
      lastLessonId: activeLesson.id,
      lessonAttempts: {
        ...progress.lessonAttempts,
        [activeLesson.id]: [...(progress.lessonAttempts[activeLesson.id] ?? []), { score, completedAt }].slice(-20),
      },
      activityDates: Array.from(new Set([...progress.activityDates, getLocalDateKey()])).sort(),
    });
    try {
      const raw = window.localStorage.getItem(CURRICULUM_REVIEW_KEY);
      const stored = raw ? (JSON.parse(raw) as unknown) : [];
      const existing = (Array.isArray(stored) ? stored : []).filter((item): item is CurriculumReviewItem => Boolean(item && typeof item === "object" && "id" in item));
      const wrongItems = activeLesson.quiz.flatMap((quiz, index) => {
        if (answers[index] === quiz.answer) return [];
        const id = `${activeLesson.id}:${index}`;
        const previous = existing.find((item) => item.id === id);
        const wrongCount = (previous?.wrongCount ?? 0) + 1;
        const intervalDays = wrongCount >= 3 ? 1 : 2;
        return [{
              id,
              lessonId: activeLesson.id,
              lessonTitle: activeLesson.title,
              prompt: quiz.prompt,
              explanation: quiz.explanation,
              createdAt: previous?.createdAt ?? completedAt,
              wrongCount,
              lastWrongAt: completedAt,
              intervalDays,
              nextReviewAt: new Date(Date.now() + intervalDays * 86_400_000).toISOString(),
            }];
      });
      const nextReview = [...existing.filter((item) => {
        if (!item || typeof item !== "object" || !("id" in item)) return false;
        return !String(item.id).startsWith(`${activeLesson.id}:`);
      }), ...wrongItems];
      window.localStorage.setItem(CURRICULUM_REVIEW_KEY, JSON.stringify(nextReview));
    } catch {
      // 복습 저장 실패가 수업 완료 기록을 막지 않도록 합니다.
    }
    setStage(5);
  };

  const submitInputAnswer = (quizIndex: number, expected: string) => {
    const normalize = (value: string) => value.normalize("NFKC").replace(/[\s。、,.!?！？]/g, "").toLowerCase();
    setAnswers((previous) => ({ ...previous, [quizIndex]: normalize(inputAnswers[quizIndex] ?? "") === normalize(expected) ? 0 : -1 }));
  };

  if (!loaded) return <div className="learn-loading">학습 기록을 불러오는 중이에요.</div>;

  if (!isLessonMode) {
    const completedTotal = progress.completedLessonIds.length;
    return (
      <section className="curriculum-page">
        <header className="curriculum-hero">
          <span>새로운 학습 과정</span>
          <h1>처음부터, 실제로 말할 수 있게</h1>
          <p>단어만 외우지 않아요. 하루 10분 동안 표현·문법·대화·말하기·문제를 한 번에 연결합니다.</p>
          <div className="curriculum-summary">
            <strong>{completedTotal}/{CURRICULUM.length}</strong>
            <span>전체 수업 완료</span>
          </div>
        </header>

        <div className="track-tabs" role="tablist" aria-label="학습 과정 선택">
          {trackOrder.map((track) => (
            <Link
              key={track}
              href={`/language/learn?track=${track}`}
              onClick={() => chooseTrack(track)}
              className={selectedTrack === track ? "is-active" : ""}
            >
              {TRACKS[track].title}
            </Link>
          ))}
        </div>

        {selectedTrack === "foundation" && (
          <section className="kana-onboarding" aria-labelledby="kana-onboarding-title">
            <div className="kana-onboarding-step" aria-hidden="true">0</div>
            <div>
              <small>왕초보라면 먼저 · 입문 0단계</small>
              <h2 id="kana-onboarding-title">히라가나·가타카나 먼저 익히기</h2>
              <p>일본어 글자를 아직 읽기 어렵다면 가나 페이지에서 기본 글자, 퀴즈, 따라 쓰기를 먼저 연습해 보세요.</p>
              <span>이미 가나를 읽을 수 있다면 아래 1단계부터 바로 시작해도 괜찮아요.</span>
            </div>
            <Link href="/language/kana">가나 학습 시작 →</Link>
          </section>
        )}

        <section className={`track-intro track-${TRACKS[selectedTrack].accent}`}>
          <div>
            <small>{selectedTrack === "foundation" ? "필수 1단계" : "목적별 실전 과정"}</small>
            <h2>{TRACKS[selectedTrack].title}</h2>
            <p>{TRACKS[selectedTrack].description}</p>
          </div>
          <strong>{lessons.filter((item) => progress.completedLessonIds.includes(item.id)).length}/{lessons.length}</strong>
        </section>

        <div className="lesson-roadmap">
          {lessons.map((item, index) => {
            const completed = progress.completedLessonIds.includes(item.id);
            const previous = lessons[index - 1];
            const locked = Boolean(previous && !progress.completedLessonIds.includes(previous.id));
            return (
              <article key={item.id} className={completed ? "lesson-node is-completed" : "lesson-node"}>
                <div className="lesson-number">{completed ? "✓" : index + 1}</div>
                <div>
                  <small>{item.minutes}분 · {item.words.length}개 표현</small>
                  <h3>{item.title}</h3>
                  <p>{item.goal}</p>
                  {progress.quizScores[item.id] !== undefined && <b>최근 점수 {progress.quizScores[item.id]}점</b>}
                </div>
                <Link href={`/language/learn?lesson=${item.id}`} aria-label={`${item.title} 학습 시작`}>
                  {completed ? "다시 학습" : locked ? "미리 보기" : "시작"} →
                </Link>
              </article>
            );
          })}
        </div>

        <section className="legacy-library">
          <div>
            <small>기존 학습 자료도 그대로</small>
            <h2>원하는 내용만 더 연습하기</h2>
            <p>새 과정에서 배운 뒤 단어·문장·문법 자료실에서 부족한 부분을 반복할 수 있어요.</p>
          </div>
          <div>
            <Link href="/language/words">단어</Link><Link href="/language/sentences">문장</Link><Link href="/language/grammar">문법</Link>
          </div>
        </section>
      </section>
    );
  }

  const stages = ["표현", "문장 원리", "대화", "말하기", "확인 문제"];
  const answeredAll = activeLesson.quiz.every((_, index) => answers[index] !== undefined);
  const trackLessons = getTrackLessons(activeLesson.track);
  const lessonIndex = trackLessons.findIndex((item) => item.id === activeLesson.id);
  const nextLesson = trackLessons[lessonIndex + 1];

  return (
    <section className="lesson-player">
      <header className="lesson-player-header">
        <Link href={`/language/learn?track=${activeLesson.track}`}>← 과정으로</Link>
        <div>
          <small>{TRACKS[activeLesson.track].title} · {activeLesson.order}단계</small>
          <h1>{activeLesson.title}</h1>
        </div>
        <span>{activeLesson.minutes}분</span>
      </header>

      {stage < 5 && (
        <>
          <div className="lesson-stage-bar" aria-label="학습 진행률">
            {stages.map((label, index) => <span key={label} className={index <= stage ? "is-active" : ""}>{label}</span>)}
          </div>
          <div className="lesson-progress"><i style={{ width: `${((stage + 1) / stages.length) * 100}%` }} /></div>
        </>
      )}

      <main className="lesson-stage-card">
        {stage === 0 && (
          <div className="lesson-words-stage">
            <p className="stage-kicker">오늘의 핵심 표현</p><h2>{activeLesson.goal}</h2>
            <div className="word-focus-grid">
              {activeLesson.words.map((word) => (
                <article key={word.japanese}><strong>{word.japanese}</strong>{showReading && <span>{word.reading}</span>}{settings.showMeaning && <p>{word.meaning}</p>}</article>
              ))}
            </div>
            <button className="text-toggle" type="button" onClick={() => setShowReading((value) => !value)}>{showReading ? "읽는 법 숨기기" : "읽는 법 보기"}</button>
          </div>
        )}
        {stage === 1 && (
          <div className="pattern-stage">
            <p className="stage-kicker">오늘은 원리 하나만</p><h2>{activeLesson.pattern.label}</h2>
            {settings.showMeaning && <p className="pattern-explanation">{activeLesson.pattern.explanation}</p>}
            <div className="pattern-example"><strong>{activeLesson.pattern.example}</strong>{settings.showMeaning && <span>{activeLesson.pattern.meaning}</span>}</div>
          </div>
        )}
        {stage === 2 && (
          <div className="dialogue-stage">
            <p className="stage-kicker">상황 속에서 들어보기</p><h2>짧은 대화를 듣고 읽어 보세요</h2>
            <button
              className="lesson-audio-button"
              type="button"
              disabled={playingAudio !== null}
              onClick={() => void playJapanese(activeLesson.dialogue.map((line) => line.japanese).join(" "), "dialogue", settings.audioRate)}
            >
              {playingAudio === "dialogue" ? "재생 중…" : "▶ 대화 전체 듣기"}
            </button>
            <button className="text-toggle" type="button" onClick={() => setShowDialogueText((value) => !value)}>{showDialogueText ? "자막 없이 듣기" : "대화 자막 보기"}</button>
            <div className="dialogue-list">
              {activeLesson.dialogue.map((line, index) => (
                <article key={`${line.speaker}-${index}`} className={`speaker-${line.speaker.toLowerCase()}`}><b>{line.speaker}</b><div>{showDialogueText && <><strong>{line.japanese}</strong>{showReading && <small>{line.reading}</small>}{settings.showMeaning && <p>{line.meaning}</p>}</>}<button type="button" className="text-toggle" disabled={playingAudio !== null} onClick={() => void playJapanese(line.japanese, "dialogue", settings.audioRate)}>한 문장 듣기</button></div></article>
              ))}
            </div>
          </div>
        )}
        {stage === 3 && (
          <div className="speaking-stage">
            <p className="stage-kicker">소리 내어 3번</p><h2>천천히 끊어 읽고, 자연스럽게 이어 보세요</h2>
            <div className="speak-prompt">{activeLesson.speak}</div>
            <div className="speaking-audio-actions" aria-label="말하기 예시 음성">
              <button type="button" disabled={playingAudio !== null} onClick={() => void playJapanese(activeLesson.speak, "slow", 0.85)}>
                {playingAudio === "slow" ? "재생 중…" : "▶ 느리게 듣기"}
              </button>
              <button type="button" disabled={playingAudio !== null} onClick={() => void playJapanese(activeLesson.speak, "normal", 0.95, 3)}>
                {playingAudio === "normal" ? "3회 재생 중…" : "↻ 보통 속도 3번"}
              </button>
            </div>
            <div className="speaking-record-actions">
              <button type="button" className={isRecording ? "is-recording" : ""} onClick={() => void toggleRecording()}>{isRecording ? "■ 녹음 끝내기" : "● 내 발음 녹음"}</button>
              {recordingUrl && <audio controls src={recordingUrl}>녹음 재생을 지원하지 않는 브라우저입니다.</audio>}
            </div>
            {recordingError && <p className="recording-error">{recordingError}</p>}
            <div className="speaking-audio-actions" aria-label="말하기 자기 점검">
              {["천천히 1회", "자연스럽게 1회", "녹음 듣고 1회"].map((label, index) => <button key={label} type="button" className={speakingChecks[index] ? "is-recording" : ""} onClick={() => setSpeakingChecks((previous) => previous.map((checked, checkIndex) => checkIndex === index ? !checked : checked))}>{speakingChecks[index] ? "✓ " : ""}{label}</button>)}
            </div>
            <p>{speakingChecks.every(Boolean) ? "3회 말하기를 완료했어요. 훌륭해요!" : "완벽한 발음보다 입으로 직접 말하는 것이 먼저예요."}</p>
          </div>
        )}
        {stage === 4 && (
          <div className="quiz-stage">
            <p className="stage-kicker">마지막 확인</p><h2>오늘 배운 내용을 확인해요</h2>
            {activeLesson.quiz.map((quiz, quizIndex) => (
              <article key={quiz.prompt} className="lesson-quiz">
                <h3>{quizIndex + 1}. {quiz.prompt}</h3>
                {quiz.kind === "listening" && <button type="button" className="lesson-audio-button" disabled={playingAudio !== null} onClick={() => void playJapanese(quiz.choices[quiz.answer], "normal", settings.audioRate, 2)}>▶ 문제 음성 2번 듣기</button>}
                {quiz.kind === "input" ? <div><input aria-label={`${quizIndex + 1}번 답`} value={inputAnswers[quizIndex] ?? ""} onChange={(event) => { setInputAnswers((previous) => ({ ...previous, [quizIndex]: event.target.value })); setAnswers((previous) => { const next = { ...previous }; delete next[quizIndex]; return next; }); }} placeholder="일본어로 입력" /><button type="button" disabled={!inputAnswers[quizIndex]?.trim()} onClick={() => submitInputAnswer(quizIndex, quiz.choices[quiz.answer])}>정답 확인</button></div> : <div>{quiz.choices.map((choice, choiceIndex) => {
                  const selected = answers[quizIndex] === choiceIndex;
                  const answered = answers[quizIndex] !== undefined;
                  const correct = choiceIndex === quiz.answer;
                  return <button key={choice} type="button" className={answered && correct ? "is-correct" : selected ? "is-wrong" : ""} onClick={() => setAnswers((prev) => ({ ...prev, [quizIndex]: choiceIndex }))}>{choice}</button>;
                })}</div>}
                {answers[quizIndex] !== undefined && <p className={answers[quizIndex] === quiz.answer ? "quiz-feedback correct" : "quiz-feedback"}>{answers[quizIndex] === quiz.answer ? "정답이에요. " : "다시 기억해 볼까요? "}{quiz.explanation}</p>}
              </article>
            ))}
          </div>
        )}
        {stage === 5 && (
          <div className="lesson-complete">
            <span>✓</span><p className="stage-kicker">오늘 학습 완료</p><h2>{activeLesson.goal}</h2>
            <strong>{progress.quizScores[activeLesson.id] ?? 0}점</strong>
            <p>마지막에 틀린 문제는 복습 화면에 모이고, 다시 맞히면 자동으로 정리돼요.</p>
            <div>{nextLesson ? <Link className="primary-start-button" href={`/language/learn?lesson=${nextLesson.id}`}>다음 수업: {nextLesson.title} →</Link> : <Link className="primary-start-button" href={`/language/learn?track=${activeLesson.track}`}>과정 완료 확인하기 →</Link>}<Link href="/language/review">복습 항목 보기</Link></div>
            {activeLesson.practice && <Link className="lesson-extra-practice" href={activeLesson.practice.href}>추가 연습: {activeLesson.practice.label} →</Link>}
          </div>
        )}
      </main>

      {stage < 5 && (
        <footer className="lesson-player-actions">
          <button type="button" disabled={stage === 0} onClick={() => setStage((value) => Math.max(0, value - 1))}>이전</button>
          {stage < 4 ? <button type="button" className="primary" onClick={() => setStage((value) => value === 2 && !settings.includeSpeaking ? 4 : value + 1)}>다음</button> : <button type="button" className="primary" disabled={!answeredAll} onClick={finishLesson}>학습 완료</button>}
        </footer>
      )}
    </section>
  );
}

export default function LearnPage() {
  return <Suspense fallback={<div className="learn-loading">과정을 준비하는 중이에요.</div>}><CurriculumContent /></Suspense>;
}
