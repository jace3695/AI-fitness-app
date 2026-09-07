"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useYeoniPreferences, updateYeoniPreferences } from "@/components/useYeoniPreferences";
import { CURRICULUM, TRACKS, getTrackLessons } from "@/data/curriculum";
import { DEFAULT_CURRICULUM_PROGRESS, CURRICULUM_REVIEW_KEY, loadCurriculumProgress } from "@/utils/curriculumProgress";
import { DEFAULT_INTEGRATED_LEARNING_SETTINGS, loadIntegratedLearningSettings, saveIntegratedLearningSettings, type IntegratedLearningSettings } from "@/utils/integratedLearningSettings";
import { normalizeLearningSession } from "@/utils/learningSession";
import LearningCompanion from "./LearningCompanion";
import styles from "./learning-focus.module.css";

export default function LearningWelcome() {
  const router = useRouter();
  const preferences = useYeoniPreferences();
  const [settings, setSettings] = useState(DEFAULT_INTEGRATED_LEARNING_SETTINGS);
  const [progress, setProgress] = useState(DEFAULT_CURRICULUM_PROGRESS);
  const [dueCount, setDueCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setSettings(loadIntegratedLearningSettings());
    setProgress(loadCurriculumProgress());
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(CURRICULUM_REVIEW_KEY) ?? "[]");
      if (Array.isArray(raw)) setDueCount(raw.filter((item) => item && typeof item === "object" && (!item.nextReviewAt || Date.parse(item.nextReviewAt) <= Date.now())).length);
    } catch { /* Keep other entry points available if old review data is damaged. */ }
    setLoaded(true);
  }, []);
  const changeSettings = (next: IntegratedLearningSettings) => {
    try { saveIntegratedLearningSettings(next); setSettings(next); setError(""); return true; }
    catch { setError("설정을 저장하지 못했어요. 기기의 저장 공간을 확인해 주세요."); return false; }
  };
  if (!loaded) return <section className={styles.welcome} role="status">오늘의 학습을 준비하고 있어요.</section>;
  const firstTime = !settings.hasChosenStart && progress.completedLessonIds.length === 0 && !progress.kanaCompletedGroups?.length && !progress.activeSession;
  const track = progress.completedLessonIds.length ? progress.selectedTrack : settings.preferredTrack;
  const lessons = getTrackLessons(track);
  const draftLesson = CURRICULUM.find((lesson) => lesson.id === progress.activeSession?.lessonId);
  const draft = draftLesson && normalizeLearningSession(progress.activeSession, draftLesson);
  const nextLesson = draft ? draftLesson! : lessons.find((lesson) => !progress.completedLessonIds.includes(lesson.id)) ?? lessons[0];
  const startKana = !draft && settings.learnerMode === "starter" && !progress.kanaCompletedGroups?.length && progress.completedLessonIds.length === 0;
  const href = startKana ? "/language/start" : "/language/learn?lesson=" + nextLesson.id;
  const selectStart = (mode: "starter" | "reader") => {
    if (changeSettings({ ...settings, learnerMode: mode, hasChosenStart: true })) router.push(mode === "starter" ? "/language/start" : "/language/learn?lesson=" + nextLesson.id);
  };
  const toggleMotion = () => {
    try { updateYeoniPreferences({ motion: preferences.motion === "off" ? "reactions" : "off" }); setError(""); }
    catch { setError("움직임 설정은 이 화면에 적용했지만 저장하지 못했어요. 기기의 저장 공간을 확인해 주세요."); }
  };
  return <section className={styles.welcome}>
    <div className={styles.welcomeHeader}>
      <h1>나의 일본어 연습</h1>
      {preferences.visible && <button type="button" className={styles.motionToggle} onClick={toggleMotion}
        aria-label={preferences.motion !== "off" ? "움직임 멈추기" : "움직임 켜기"}
        title={preferences.motion !== "off" ? "움직임 멈추기" : "움직임 켜기"}>
        {preferences.motion !== "off" ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        <span>{preferences.motion !== "off" ? "움직임 멈추기" : "움직임 켜기"}</span>
      </button>}
    </div>
    <LearningCompanion hidden={!preferences.visible} motion="ambient">
      {firstTime ? "안녕! 나랑 첫 글자부터 배워봐요." : draft ? "하던 연습을 나랑 이어갈까요?" : "오늘도 나랑 조금씩 배워봐요!"}
    </LearningCompanion>
    <div className={styles.card}>
      <p className={styles.kicker}>오늘은 얼마나 해볼까요?</p>
      <div className={styles.timeChoices} aria-label="하루 학습 시간">{([5, 10, 20] as const).map((minutes) => <button key={minutes} type="button" aria-pressed={settings.dailyMinutes === minutes} onClick={() => changeSettings({ ...settings, dailyMinutes: minutes })}>{minutes}분</button>)}</div>
      <p className={styles.muted}>{settings.dailyMinutes === 5 ? "표현 3개 · 확인 3문제 · 말하기는 다음에" : settings.dailyMinutes === 10 ? "표현 3개 · 확인 최대 5문제 · 짧게 따라 말하기" : "표현 3개 · 확인 8문제 · 반복해서 따라 말하기"}{!settings.includeSpeaking && settings.dailyMinutes !== 5 ? " · 말하기 제외 설정 적용" : ""}</p>
      {firstTime ? <><h2>어디서 시작할까요?</h2><div className={styles.options}><button className={styles.option} type="button" onClick={() => selectStart("starter")}><strong>글자를 처음 배워요</strong><span>あ・い・う・え・お부터 함께</span></button><button className={styles.option} type="button" onClick={() => selectStart("reader")}><strong>조금 읽을 수 있어요</strong><span>짧은 표현과 대화부터</span></button></div></> : <><p className={styles.kicker}>{startKana ? "가나 첫걸음" : TRACKS[nextLesson.track].title}</p><h2>{startKana ? "첫 다섯 글자와 친해지기" : nextLesson.title}</h2><div className={styles.row}><Link href={href} className={styles.primary}>{draft ? "하던 연습 이어하기" : startKana ? "첫 글자 배우기" : "오늘의 연습 시작"} →</Link></div>{draft && <p className={styles.muted}>이어하는 수업은 시작할 때 정한 {draft.minutes}분 분량이에요. 바꾼 시간은 새 수업부터 적용돼요.</p>}</>}
      {dueCount > 0 && <div className={styles.row}><Link href="/language/review">먼저 복습할 문제 {dueCount}개</Link></div>}
      <p className={styles.muted}>해본 수업 {progress.completedLessonIds.length} / {CURRICULUM.length} · 점수와 복습은 ‘내 학습’에서 확인해요.</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  </section>;
}
