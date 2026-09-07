"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TRACKS, getTrackLessons, type CurriculumLesson } from "@/data/curriculum";
import { toKoreanPronunciation } from "@/data/learningDataExpansion";
import { CURRICULUM_REVIEW_KEY, loadCurriculumProgress, saveCurriculumProgress, type CurriculumReviewItem } from "@/utils/curriculumProgress";
import { DEFAULT_INTEGRATED_LEARNING_SETTINGS, loadIntegratedLearningSettings } from "@/utils/integratedLearningSettings";
import { answerSessionQuestion, createLearningSession, getSessionQuizIndices, getSessionResult, normalizeLearningSession, retrySessionQuestion, updateSessionReviews, withLearningSessionDraft, withoutLearningSessionDraft } from "@/utils/learningSession";
import { getLocalDateKey } from "@/utils/dateKey";
import LearningCompanion from "./LearningCompanion";
import LearningQuestion from "./LearningQuestion";
import { useLearningAudio } from "./useLearningAudio";
import styles from "./learning-focus.module.css";

const stageNames = ["표현 하나씩", "문장 만들기", "대화 듣기", "따라 말하기", "한 문제씩"];
const stageGuides = ["처음부터 외우지 않아도 돼요. 뜻을 보고 소리를 한 번 들어봐요.", "오늘은 이 표현 하나만 기억해요. 어려운 이름보다 ‘언제 쓰는지’가 중요해요.", "두 사람이 무슨 이야기를 하는지 들어볼까요? 자막을 봐도 괜찮아요.", "내 목소리로 한 번 말해봐요. 지금은 정확함보다 시도가 먼저예요.", "한 문제씩 해봐요. 틀리면 힌트를 보고 다시 도전할 수 있어요."];

export default function FocusedLesson({ lesson }: { lesson: CurriculumLesson }) {
  const [settings, setSettings] = useState(DEFAULT_INTEGRATED_LEARNING_SETTINGS);
  const [session, setSession] = useState(() => createLearningSession(lesson.id, 10, "starter"));
  const [loaded, setLoaded] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showDialogue, setShowDialogue] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordError, setRecordError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingObjectUrl = useRef<string | null>(null);
  const recordingRequest = useRef(0);
  const mounted = useRef(true);
  const finishing = useRef(false);
  const audio = useLearningAudio();
  const { stop, play } = audio;
  const quizIndices = getSessionQuizIndices(lesson, session.minutes);
  const questionIndex = quizIndices[session.quizCursor];
  const result = getSessionResult(lesson, session);
  const word = lesson.words[session.wordIndex];
  const includeSpeaking = settings.includeSpeaking && session.minutes !== 5;
  const visibleStages = includeSpeaking ? [0, 1, 2, 3, 4] : [0, 1, 2, 4];
  const trackLessons = getTrackLessons(lesson.track);
  const nextLesson = trackLessons[trackLessons.findIndex((item) => item.id === lesson.id) + 1];

  useEffect(() => {
    const storedSettings = loadIntegratedLearningSettings();
    const progress = loadCurriculumProgress();
    const draft = normalizeLearningSession(progress.lessonDrafts?.[lesson.id] ?? progress.activeSession, lesson);
    setSettings(storedSettings);
    const restored = draft ?? createLearningSession(lesson.id, storedSettings.dailyMinutes, storedSettings.learnerMode);
    if (restored.stage === 3 && (!storedSettings.includeSpeaking || restored.minutes === 5)) restored.stage = 4;
    setSession(restored);
    setResumed(Boolean(draft));
    setLoaded(true);
  }, [lesson]);

  useEffect(() => {
    if (!loaded || finished || finishing.current) return;
    try {
      const latest = loadCurriculumProgress();
      saveCurriculumProgress(withLearningSessionDraft(latest, session));
      setSaveError("");
    } catch {
      setSaveError("이 기기에 이어할 내용을 저장하지 못했어요. 저장 공간이나 비공개 브라우징 설정을 확인해 주세요.");
    }
  }, [loaded, finished, session]);

  useEffect(() => {
    mounted.current = true;
    const pauseRecordingWhenHidden = () => {
      if (!document.hidden) return;
      recordingRequest.current += 1;
      if (recorder.current?.state === "recording") recorder.current.stop();
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
    document.addEventListener("visibilitychange", pauseRecordingWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", pauseRecordingWhenHidden);
      mounted.current = false;
      recordingRequest.current += 1;
      if (recorder.current?.state === "recording") recorder.current.stop();
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
      if (recordingObjectUrl.current) URL.revokeObjectURL(recordingObjectUrl.current);
    };
  }, []);

  useEffect(() => {
    if (!loaded || finished || resumed || session.stage !== 2 || !settings.autoPlayDialogue) return;
    void play(lesson.dialogue.map((line) => line.japanese).join(" "), settings.audioRate);
    return stop;
  }, [loaded, finished, resumed, session.stage, settings.autoPlayDialogue, settings.audioRate, lesson, play, stop]);

  const stopRecording = () => {
    recordingRequest.current += 1;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
  };

  const changeStage = (stage: number) => {
    stop();
    stopRecording();
    setResumed(false);
    setSession((previous) => ({ ...previous, stage }));
  };

  const toggleRecording = async () => {
    if (recording) { stopRecording(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setRecordError("녹음을 지원하지 않는 기기예요. 소리를 듣고 따라 말하기만 해도 괜찮아요."); return; }
    const request = ++recordingRequest.current;
    let allocatedStream: MediaStream | undefined;
    try {
      setRecordError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      allocatedStream = stream;
      if (!mounted.current || recordingRequest.current !== request) { stream.getTracks().forEach((track) => track.stop()); return; }
      const next = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      next.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        if (recordingObjectUrl.current) URL.revokeObjectURL(recordingObjectUrl.current);
        const url = URL.createObjectURL(new Blob(chunks, { type: next.mimeType || "audio/webm" }));
        recordingObjectUrl.current = url;
        setRecordingUrl(url);
        setRecording(false);
      };
      recorder.current = next;
      next.start();
      setRecording(true);
    } catch { allocatedStream?.getTracks().forEach((track) => track.stop()); if (mounted.current) setRecordError("마이크를 사용할 수 없어요. 녹음 없이 듣고 따라 말해도 학습을 계속할 수 있어요."); }
  };

  const finish = () => {
    if (!result.complete || finishing.current) return;
    finishing.current = true;
    stop();
    stopRecording();
    try {
      const now = new Date();
      const latest = loadCurriculumProgress();
      const raw = localStorage.getItem(CURRICULUM_REVIEW_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) throw new Error("Review data is not an array");
      const previousReviews = parsed.filter((item): item is CurriculumReviewItem => Boolean(item && typeof item === "object" && typeof item.id === "string"));
      const reviews = updateSessionReviews(previousReviews, lesson, session, now);
      localStorage.setItem(CURRICULUM_REVIEW_KEY, JSON.stringify(reviews));
      saveCurriculumProgress({
        ...withoutLearningSessionDraft(latest, session), selectedTrack: lesson.track, lastLessonId: lesson.id,
        completedLessonIds: [...new Set([...latest.completedLessonIds, lesson.id])],
        quizScores: { ...latest.quizScores, [lesson.id]: result.score },
        lessonAttempts: { ...latest.lessonAttempts, [lesson.id]: [...(latest.lessonAttempts[lesson.id] ?? []).filter((attempt) => attempt.sessionId !== session.id), { score: result.score, completedAt: now.toISOString(), sessionId: session.id }].slice(-20) },
        activityDates: [...new Set([...latest.activityDates, getLocalDateKey()])].sort(),
      });
      setSaveError("");
      setFinished(true);
    } catch {
      setSaveError("학습 결과를 저장하지 못했어요. 이 화면을 닫지 말고 저장을 다시 시도해 주세요. 기존 기록은 초기화하지 않습니다.");
      finishing.current = false;
    }
  };

  if (!loaded) return <div className={styles.focus} role="status">이어할 학습을 준비하고 있어요.</div>;
  const stagePosition = visibleStages.indexOf(session.stage);
  const next = () => {
    if (session.stage === 0 && session.wordIndex < lesson.words.length - 1) {
      stop(); setSession((previous) => ({ ...previous, wordIndex: previous.wordIndex + 1 })); return;
    }
    if (session.stage === 4) {
      if (session.quizCursor < quizIndices.length - 1) { stop(); setSession((previous) => ({ ...previous, quizCursor: previous.quizCursor + 1 })); }
      else finish();
      return;
    }
    changeStage(visibleStages[stagePosition + 1] ?? 4);
  };
  const previous = () => {
    if (session.stage === 0 && session.wordIndex > 0) { stop(); setSession((value) => ({ ...value, wordIndex: value.wordIndex - 1 })); }
    else if (session.stage === 4 && session.quizCursor > 0) { stop(); setSession((value) => ({ ...value, quizCursor: value.quizCursor - 1 })); }
    else changeStage(visibleStages[Math.max(0, stagePosition - 1)]);
  };

  return <section className={styles.focus} aria-label="집중 학습">
    <header className={styles.header}>
      <Link href={"/language/learn?track=" + lesson.track} className={styles.back}>← 과정으로</Link>
      <div><small>{TRACKS[lesson.track].title} · {lesson.order}번째 수업</small><h1>{lesson.title}</h1></div>
      <span className={styles.pill}>약 {session.minutes}분</span>
    </header>
    {!finished && <><ol className={styles.stageTrack} aria-label="수업 단계">{visibleStages.map((stage) => <li key={stage} data-active={stage <= session.stage} aria-current={stage === session.stage ? "step" : undefined}><span className="sr-only">{stageNames[stage]}</span></li>)}</ol><div className={styles.stageLabel}><span>{stageNames[session.stage]}</span><span>{stagePosition + 1} / {visibleStages.length} 단계</span></div></>}
    <LearningCompanion hidden={!settings.showCompanion || (!finished && session.stage === 4)}
      action={finished ? result.needsPractice ? "encourage" : "celebrate" : "explain"}
      motionKey={`${lesson.id}:${session.stage}:${session.wordIndex}:${session.quizCursor}:${finished}`}>
      {finished ? result.needsPractice ? "끝까지 해봤네요! 아직 어려운 문제는 함께 한 번 더 살펴봐요." : "잘했어요! 오늘 연습한 표현을 생활 속에서도 한 번 써봐요." : stageGuides[session.stage]}
    </LearningCompanion>
    {resumed && !finished && <p className={styles.muted}>지난번 멈춘 곳에서 이어해요. 소리와 녹음은 꺼진 상태로 시작해요.</p>}
    {saveError && <p className={styles.error} role="alert">{saveError}</p>}
    {audio.audioError && <p className={styles.error} role="status">{audio.audioError}</p>}
    <div className={styles.card}>
      {!finished && session.stage === 0 && <><p className={styles.kicker}>오늘의 표현 {session.wordIndex + 1} / {lesson.words.length}</p>
        <div className={styles.word}><strong className={styles.japanese} lang="ja">{word.japanese}</strong>{settings.showReading && <span className={styles.reading} lang="ja">{word.reading}</span>}{settings.showKoreanHint && <span className={styles.korean}>발음 도움: {toKoreanPronunciation(word.reading)}</span>}{settings.showMeaning && <p className={styles.meaning}>{word.meaning}</p>}</div>
        <div className={styles.row}><button type="button" disabled={audio.playing} onClick={() => void play(word.japanese, settings.audioRate)}>▶ 소리 듣기</button></div>
      </>}
      {!finished && session.stage === 1 && <><p className={styles.kicker}>이럴 때 쓰면 돼요</p><h2>{lesson.pattern.explanation}</h2><div className={styles.word}><strong className={styles.japanese} lang="ja">{lesson.pattern.example}</strong>{settings.showMeaning && <p className={styles.meaning}>{lesson.pattern.meaning}</p>}</div><div className={styles.row}><button type="button" disabled={audio.playing} onClick={() => void play(lesson.pattern.example, settings.audioRate)}>▶ 문장 듣기</button></div><details className={styles.details}><summary>문장 모양 살펴보기</summary><p>{lesson.pattern.label}</p></details></>}
      {!finished && session.stage === 2 && <><p className={styles.kicker}>상황 속에서 만나기</p><h2>짧은 대화를 들어봐요</h2><div className={styles.row}><button type="button" disabled={audio.playing} onClick={() => void play(lesson.dialogue.map((line) => line.japanese).join(" "), settings.audioRate)}>▶ 대화 듣기</button><button type="button" onClick={() => setShowDialogue((value) => !value)}>{showDialogue ? "자막 없이 듣기" : "자막 보기"}</button></div><div className={styles.dialogue}>{lesson.dialogue.map((line, index) => <article key={index}><small>{line.speaker === "A" ? "먼저 말해요" : "이렇게 답해요"}</small>{showDialogue && <><strong lang="ja">{line.japanese}</strong>{settings.showReading && <span className={styles.reading} lang="ja">{line.reading}</span>}{settings.showMeaning && <p>{line.meaning}</p>}</>}<div className={styles.row}><button type="button" disabled={audio.playing} onClick={() => void play(line.japanese, settings.audioRate)}>▶ 이 문장 듣기</button></div></article>)}</div></>}
      {!finished && session.stage === 3 && <><p className={styles.kicker}>입으로 한 번 해보기</p><h2>소리를 듣고 따라 말해봐요</h2><strong className={styles.japanese} lang="ja">{lesson.speak}</strong><div className={styles.row}><button type="button" disabled={audio.playing} onClick={() => void play(lesson.speak, 0.8)}>▶ 천천히 듣기</button><button type="button" disabled={audio.playing} onClick={() => void play(lesson.speak, settings.audioRate, session.minutes === 20 ? 3 : 1)}>▶ {session.minutes === 20 ? "세 번" : "한 번"} 더 듣기</button></div><div className={styles.row}>{Array.from({ length: session.minutes === 20 ? 3 : 1 }, (_, index) => <button type="button" key={index} aria-pressed={session.speakingChecks[index]} onClick={() => setSession((value) => ({ ...value, speakingChecks: value.speakingChecks.map((checked, position) => position === index ? !checked : checked) }))}>{session.speakingChecks[index] ? "✓ " : ""}{index + 1}번 말해봤어요</button>)}</div><details className={styles.details}><summary>내 목소리도 들어볼래요 · 선택</summary><p className={styles.muted}>녹음은 전송하지 않아요. 이 화면을 떠나면 사라집니다.</p><div className={styles.row}><button type="button" onClick={() => void toggleRecording()}>{recording ? "■ 녹음 끝내기" : "● 녹음 시작"}</button></div>{recordingUrl && <audio controls src={recordingUrl} style={{ width: "100%" }} />}{recordError && <p role="status" className={styles.error}>{recordError}</p>}</details></>}
      {!finished && session.stage === 4 && <><p className={styles.kicker}>확인 문제 {session.quizCursor + 1} / {quizIndices.length}</p><LearningQuestion key={questionIndex} lesson={lesson} index={questionIndex} mode={session.mode} showCompanion={settings.showCompanion} answer={session.answers[questionIndex]} response={session.responses[questionIndex]} onAnswer={(correct, response) => setSession((value) => answerSessionQuestion(value, questionIndex, correct, response))} onRetry={() => setSession((value) => retrySessionQuestion(value, questionIndex))} play={(text) => void play(text, settings.audioRate)} playing={audio.playing} /></>}
      {finished && <div className={styles.success}><span className={styles.successMark} aria-hidden="true">✓</span><h2>오늘의 연습을 저장했어요</h2><p>{lesson.goal}</p><div className={styles.score}><div><span>첫 선택 · 힌트 포함</span><strong>{result.firstCorrect} / {result.total}</strong></div><div><span>다시 풀기까지</span><strong>{result.correct} / {result.total}</strong></div></div><p>{result.needsPractice ? "아직 어려운 문제는 지금 복습에서 다시 볼 수 있어요." : result.firstCorrect < result.total ? "다시 맞힌 문제는 내일 복습에서 한 번 더 만나요." : "오늘 배운 내용을 잘 골랐어요. 다음에도 기억나는지 확인해봐요."}</p><div className={styles.row}>{result.needsPractice ? <Link href="/language/review" className={styles.primary}>어려웠던 문제 다시 보기</Link> : nextLesson ? <Link href={"/language/learn?lesson=" + nextLesson.id} className={styles.primary}>다음 수업 보기</Link> : <Link href="/language/progress" className={styles.primary}>내 학습 보기</Link>}<Link href="/language">오늘은 여기까지</Link></div>{nextLesson && result.needsPractice && <Link className={styles.back} href={"/language/learn?lesson=" + nextLesson.id}>다음 수업도 살펴보기</Link>}{lesson.practice && <div className={styles.row}><Link href={lesson.practice.href.startsWith("/language/") ? lesson.practice.href : "/language" + lesson.practice.href}>더 연습: {lesson.practice.label}</Link></div>}</div>}
    </div>
    {audio.playing && <div className={styles.row}><button type="button" onClick={stop}>■ 소리 멈추기</button></div>}
    {!finished && <><footer className={styles.actions}><button type="button" disabled={session.stage === 0 && session.wordIndex === 0} onClick={previous}>이전</button><button type="button" className={styles.primary} disabled={session.stage === 4 && session.answers[questionIndex] === undefined} onClick={next}>{session.stage === 4 ? session.quizCursor === quizIndices.length - 1 ? "오늘 연습 저장하기" : session.answers[questionIndex] === false ? "복습에 남기고 다음" : "다음 문제" : session.stage === 0 && session.wordIndex < lesson.words.length - 1 ? "다음 표현" : "다음으로"}</button></footer><details className={styles.details}><summary>읽기 도움 조절</summary><label><input type="checkbox" checked={settings.showReading} onChange={(event) => setSettings((value) => ({ ...value, showReading: event.target.checked }))} /> 일본어 읽는 법</label><label><input type="checkbox" checked={settings.showMeaning} onChange={(event) => setSettings((value) => ({ ...value, showMeaning: event.target.checked }))} /> 한국어 뜻</label><label><input type="checkbox" checked={settings.showKoreanHint} onChange={(event) => setSettings((value) => ({ ...value, showKoreanHint: event.target.checked }))} /> 단어 한글 발음 도움</label><p className={styles.muted}>한글은 대략적인 도움말이에요. 실제 소리는 듣기 버튼으로 확인해요. 이 화면의 조절은 이번 학습에만 적용돼요.</p></details></>}
  </section>;
}
