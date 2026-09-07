"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CURRICULUM, TRACKS, getTrackLessons, type CourseTrack } from "@/data/curriculum";
import { DEFAULT_CURRICULUM_PROGRESS, loadCurriculumProgress, saveCurriculumProgress } from "@/utils/curriculumProgress";
import { DEFAULT_INTEGRATED_LEARNING_SETTINGS, loadIntegratedLearningSettings } from "@/utils/integratedLearningSettings";
import FocusedLesson from "@/components/language/FocusedLesson";

const trackOrder: CourseTrack[] = ["foundation", "work", "travel"];

function CurriculumContent() {
  const searchParams = useSearchParams();
  const requestedTrack = searchParams.get("track");
  const [progress, setProgress] = useState(DEFAULT_CURRICULUM_PROGRESS);
  const [settings, setSettings] = useState(DEFAULT_INTEGRATED_LEARNING_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setProgress(loadCurriculumProgress());
    setSettings(loadIntegratedLearningSettings());
    setLoaded(true);
  }, []);
  const selectedTrack: CourseTrack = trackOrder.includes(requestedTrack as CourseTrack) ? requestedTrack as CourseTrack : progress.selectedTrack;
  const lessons = getTrackLessons(selectedTrack);
  const chooseTrack = (track: CourseTrack) => {
    try {
      const latest = { ...loadCurriculumProgress(), selectedTrack: track };
      saveCurriculumProgress(latest);
      setProgress(latest);
      setError("");
    } catch { setError("과정 선택을 저장하지 못했어요. 수업은 계속 볼 수 있어요."); }
  };
  if (!loaded) return <div className="learn-loading" role="status">학습 기록을 불러오는 중이에요.</div>;
  return <section className="curriculum-page">
    <header className="curriculum-hero">
      <span>나만의 작은 일본어 교실</span>
      <h1>한 번에 하나씩, 내 속도로</h1>
      <p>지금은 약 {settings.dailyMinutes}분 분량이에요. 정해진 시간 안에 끝내지 않아도 괜찮아요.</p>
      <div className="curriculum-summary"><strong>{progress.completedLessonIds.filter((id) => CURRICULUM.some((lesson) => lesson.id === id)).length}/{CURRICULUM.length}</strong><span>해본 수업 · 숙달 평가는 아니에요</span></div>
    </header>
    {error && <p role="alert">{error}</p>}
    <nav className="track-tabs" aria-label="학습 과정 선택">
      {trackOrder.map((track) => <Link key={track} href={`/language/learn?track=${track}`} onClick={() => chooseTrack(track)} aria-current={selectedTrack === track ? "page" : undefined} className={selectedTrack === track ? "is-active" : ""}>{TRACKS[track].title}</Link>)}
    </nav>
    {selectedTrack === "foundation" && <section className="kana-onboarding" aria-labelledby="kana-onboarding-title">
      <div className="kana-onboarding-step" aria-hidden="true">0</div>
      <div><small>글자를 몰라도 괜찮아요</small><h2 id="kana-onboarding-title">あ・い・う・え・お부터</h2><p>한 묶음씩 소리를 듣고 맞혀 봐요. 이미 읽을 수 있다면 아래 수업부터 시작해도 좋아요.</p></div>
      <Link href="/language/start">글자 첫걸음 →</Link>
    </section>}
    <section className={`track-intro track-${TRACKS[selectedTrack].accent}`}>
      <div><small>{selectedTrack === "foundation" ? "추천 시작 과정" : "목적별 연습"}</small><h2>{TRACKS[selectedTrack].title}</h2><p>{TRACKS[selectedTrack].description}</p></div>
      <strong>{lessons.filter((item) => progress.completedLessonIds.includes(item.id)).length}/{lessons.length}</strong>
    </section>
    <div className="lesson-roadmap">{lessons.map((item, index) => {
      const completed = progress.completedLessonIds.includes(item.id);
      return <article key={item.id} className={completed ? "lesson-node is-completed" : "lesson-node"}>
        <div className="lesson-number">{completed ? "✓" : index + 1}</div>
        <div><small>약 {settings.dailyMinutes}분 · {item.words.length}개 표현</small><h3>{item.title}</h3><p>{item.goal}</p>{progress.quizScores[item.id] !== undefined && <b>최근 확인 점수 {progress.quizScores[item.id]}점 · 힌트 사용 가능</b>}</div>
        <Link href={`/language/learn?lesson=${item.id}`} aria-label={`${item.title} ${completed ? "다시 학습" : "시작"}`}>{completed ? "다시 학습" : "시작"} →</Link>
      </article>;
    })}</div>
    <section className="legacy-library"><div><small>필요할 때만 더 연습해요</small><h2>단어·문장·문법 자료실</h2><p>숫자와 단위는 따로 골라 연습할 수 있어요. 기존 저장 자료도 그대로예요.</p></div><div><Link href="/language/words">단어</Link><Link href="/language/sentences">문장</Link><Link href="/language/grammar">문법</Link></div></section>
  </section>;
}

function LearningRoute() {
  const params = useSearchParams();
  const lessonId = params.get("lesson");
  if (!lessonId) return <CurriculumContent />;
  const lesson = CURRICULUM.find((item) => item.id === lessonId);
  if (!lesson) return <section className="curriculum-page"><h1>수업을 찾지 못했어요</h1><p>링크가 잘못되었거나 바뀌었어요. 학습 기록은 그대로 있어요.</p><Link href="/language/learn">전체 수업에서 고르기</Link></section>;
  return <FocusedLesson key={lesson.id} lesson={lesson} />;
}

export default function LearnPage() {
  return <Suspense fallback={<div className="learn-loading">수업을 준비하고 있어요.</div>}><LearningRoute /></Suspense>;
}
