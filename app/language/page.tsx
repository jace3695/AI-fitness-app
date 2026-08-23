"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getLocalDateKey } from "@/utils/dateKey";
import {
  getTodayRoutineCompletedIds,
  saveTodayRoutineCompletedIds,
} from "@/utils/dailyRoutineProgress";
import { CURRICULUM, TRACKS, getTrackLessons, type CourseTrack } from "@/data/curriculum";
import { loadCurriculumProgress } from "@/utils/curriculumProgress";

type RoutineItem = {
  id: string;
  href: string;
  title: string;
  desc: string;
  duration: string;
  cta: string;
};

const todayRoutine: RoutineItem[] = [
  {
    id: "kana",
    href: "/language/kana",
    title: "가나 5문제 풀기",
    desc: "히라가나·가타카나를 빠르게 확인하며 감각을 깨워요.",
    duration: "약 5분",
    cta: "가나 학습하기",
  },
  {
    id: "words",
    href: "/language/words",
    title: "단어 퀴즈 풀기 5문제",
    desc: "자주 쓰는 단어를 짧은 퀴즈로 반복해 기억을 강화해요.",
    duration: "약 7분",
    cta: "단어 퀴즈 풀기",
  },
  {
    id: "sentences",
    href: "/language/sentences",
    title: "문장 3개 듣고 따라 말하기",
    desc: "짧은 문장을 듣고 소리 내어 말하며 리듬을 익혀요.",
    duration: "약 8분",
    cta: "문장 학습하기",
  },
  {
    id: "grammar",
    href: "/language/grammar",
    title: "문법 1개 풀기",
    desc: "기본 문법을 짧게 확인하고 문제로 점검해요.",
    duration: "약 5분",
    cta: "문법 학습하기",
  },
  {
    id: "review",
    href: "/language/review",
    title: "복습 항목 확인",
    desc: "저장한 단어와 틀린 항목을 다시 확인해요.",
    duration: "약 5분",
    cta: "복습하기",
  },
];

const learningCourses = [
  {
    href: "/language/learn?track=foundation",
    eyebrow: "처음부터",
    title: "기초 다지기",
    desc: "히라가나부터 단어와 기본 문장까지 차근차근 배워요.",
    tone: "mint",
  },
  {
    href: "/language/learn?track=work",
    eyebrow: "회사에서",
    title: "직장 일본어",
    desc: "인사, 요청, 확인, 보고처럼 업무에 필요한 표현을 연습해요.",
    tone: "blue",
  },
  {
    href: "/language/learn?track=travel",
    eyebrow: "여행에서",
    title: "여행 일본어",
    desc: "공항, 교통, 식당, 쇼핑, 숙소에서 바로 쓰는 문장을 익혀요.",
    tone: "coral",
  },
];

const practicalPractice: RoutineItem[] = [
  {
    id: "conversation",
    href: "/language/conversation",
    title: "AI 회화 바로가기",
    desc: "상황별 대화를 통해 실전 일본어 대응력을 길러요.",
    duration: "10분+",
    cta: "AI 회화",
  },
  {
    id: "writing",
    href: "/language/writing",
    title: "쓰기 연습 바로가기",
    desc: "오늘 배운 표현을 직접 써보며 문장 구성을 다져요.",
    duration: "10분+",
    cta: "쓰기 연습",
  },
];

type RecommendationState = {
  hasGrammarWrong: boolean;
  hasReviewItems: boolean;
};

const getArrayLength = (value: unknown) => (Array.isArray(value) ? value.length : 0);
const getSafeCompletedIds = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return todayRoutine
    .map((item) => item.id)
    .filter((id) => value.includes(id));
};

export default function HomePage() {
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [recommendation, setRecommendation] = useState<RecommendationState>({
    hasGrammarWrong: false,
    hasReviewItems: false,
  });
  const todayKey = useMemo(() => getLocalDateKey(), []);
  const [hasLoadedRoutine, setHasLoadedRoutine] = useState(false);
  const [curriculumState, setCurriculumState] = useState({
    nextLessonId: CURRICULUM[0].id,
    nextLessonTitle: CURRICULUM[0].title,
    track: "foundation" as CourseTrack,
    completed: 0,
    trackCompleted: 0,
    trackTotal: getTrackLessons("foundation").length,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const todayCompletedIds = getTodayRoutineCompletedIds(todayKey);
      setCompletedIds(getSafeCompletedIds(todayCompletedIds));

      const grammarProgressRaw = window.localStorage.getItem("grammarProgress");
      const wrongKanaRaw = window.localStorage.getItem("wrongKana");
      const wrongKanaCharsRaw = window.localStorage.getItem("wrongKanaChars");
      const wrongWordsRaw = window.localStorage.getItem("wrongWords");
      const wrongSentencesRaw = window.localStorage.getItem("wrongSentences");
      const savedWordsRaw = window.localStorage.getItem("savedWords");
      const savedSentencesRaw = window.localStorage.getItem("savedSentences");

      const grammarProgress = grammarProgressRaw ? (JSON.parse(grammarProgressRaw) as unknown) : null;
      const wrongKana = wrongKanaRaw ? (JSON.parse(wrongKanaRaw) as unknown) : null;
      const wrongKanaChars = wrongKanaCharsRaw ? (JSON.parse(wrongKanaCharsRaw) as unknown) : null;
      const wrongWords = wrongWordsRaw ? (JSON.parse(wrongWordsRaw) as unknown) : null;
      const wrongSentences = wrongSentencesRaw ? (JSON.parse(wrongSentencesRaw) as unknown) : null;
      const savedWords = savedWordsRaw ? (JSON.parse(savedWordsRaw) as unknown) : null;
      const savedSentences = savedSentencesRaw ? (JSON.parse(savedSentencesRaw) as unknown) : null;

      const grammarItems = Array.isArray(grammarProgress) ? grammarProgress : [];
      const hasGrammarWrong = grammarItems.some((item) => {
        if (typeof item !== "object" || item === null) return false;
        const wrongCount = "wrongCount" in item ? (item as { wrongCount?: unknown }).wrongCount : 0;
        const lastResult = "lastResult" in item ? (item as { lastResult?: unknown }).lastResult : "";
        return (typeof wrongCount === "number" && wrongCount > 0) || lastResult === "wrong";
      });

      const reviewCount =
        getArrayLength(wrongKana) +
        getArrayLength(wrongKanaChars) +
        getArrayLength(wrongWords) +
        getArrayLength(wrongSentences) +
        getArrayLength(savedWords) +
        getArrayLength(savedSentences);

      setRecommendation({
        hasGrammarWrong,
        hasReviewItems: hasGrammarWrong || reviewCount > 0,
      });

      const curriculumProgress = loadCurriculumProgress();
      const selectedLessons = getTrackLessons(curriculumProgress.selectedTrack);
      const nextLesson =
        selectedLessons.find((lesson) => !curriculumProgress.completedLessonIds.includes(lesson.id)) ??
        selectedLessons[0];
      setCurriculumState({
        nextLessonId: nextLesson.id,
        nextLessonTitle: nextLesson.title,
        track: curriculumProgress.selectedTrack,
        completed: curriculumProgress.completedLessonIds.length,
        trackCompleted: selectedLessons.filter((lesson) => curriculumProgress.completedLessonIds.includes(lesson.id)).length,
        trackTotal: selectedLessons.length,
      });
    } catch {
      setCompletedIds([]);
      setRecommendation({ hasGrammarWrong: false, hasReviewItems: false });
    } finally {
      setHasLoadedRoutine(true);
    }
  }, [todayKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasLoadedRoutine) return;

    const safeCompletedIds = Array.from(new Set(getSafeCompletedIds(completedIds)));
    saveTodayRoutineCompletedIds(todayKey, safeCompletedIds, todayRoutine.length);
  }, [completedIds, hasLoadedRoutine, todayKey]);

  const completedCount = completedIds.length;
  const progressPercent = Math.round((curriculumState.trackCompleted / curriculumState.trackTotal) * 100);
  const toggleCompleted = (id: string) => {
    setCompletedIds((prev) =>
      prev.includes(id) ? prev.filter((completedId) => completedId !== id) : [...prev, id],
    );
  };

  return (
    <section className="home-page">
      <div className="home-container">
        <div className="home-greeting">
          <p className="home-kicker">こんにちは, Jace!</p>
          <h1>오늘도 딱 10분만 해볼까요?</h1>
          <p>회사와 여행에서 진짜 쓰는 일본어를 한 단계씩 배워요.</p>
        </div>

        <section className="today-lesson-card" aria-labelledby="today-lesson-title">
          <div className="today-lesson-top">
            <div>
              <span className="today-badge">오늘의 통합 10분</span>
              <p className="today-step">{TRACKS[curriculumState.track].title} · 다음 수업</p>
              <h2 id="today-lesson-title">{curriculumState.nextLessonTitle}</h2>
              <p>핵심 표현부터 문법·대화·말하기·확인 문제까지 한 번에 이어서 배워요.</p>
            </div>
            <div className="today-progress-ring" style={{ "--progress": `${progressPercent * 3.6}deg` } as React.CSSProperties}>
              <strong>{progressPercent}%</strong>
              <span>{curriculumState.trackCompleted}/{curriculumState.trackTotal}</span>
            </div>
          </div>
          <Link className="primary-start-button" href={`/language/learn?lesson=${curriculumState.nextLessonId}`}>
            {curriculumState.completed === 0 ? "첫 10분 학습 시작" : "다음 수업 이어서 학습"}
            <span aria-hidden="true">→</span>
          </Link>
          <p className="today-helper">새 과정 {curriculumState.completed}/{CURRICULUM.length}개 완료 · 기존 오늘 학습 기록도 그대로 유지돼요.</p>
        </section>

        <details className="routine-details">
          <summary>기존 자유 학습 바로가기 <span>{completedCount}/{todayRoutine.length} 완료</span></summary>
          <section className="routine-list">
          {todayRoutine.map((item) => {
            const isCompleted = completedIds.includes(item.id);
            return (
              <article key={item.id} className={isCompleted ? "routine-row is-completed" : "routine-row"}>
                <div>
                  <div className="routine-row-title">
                    <h3>{item.title}</h3>
                    {isCompleted && (
                      <span
                        style={{
                          color: "#16734a", fontSize: "12px", fontWeight: 800,
                        }}
                      >
                        ✓ 완료됨
                      </span>
                    )}
                  </div>
                  <p>{item.desc} · {item.duration}</p>
                </div>

                <div className="routine-row-actions">
                  <Link href={item.href}>{item.cta}</Link>
                  <button
                    type="button"
                    onClick={() => toggleCompleted(item.id)}
                  >
                    {isCompleted ? "완료 취소" : "직접 완료"}
                  </button>
                </div>
              </article>
            );
          })}
          </section>
        </details>

        {recommendation.hasReviewItems && (
          <Link href={recommendation.hasGrammarWrong ? "/language/grammar" : "/language/review"} className="review-nudge">
            <span aria-hidden="true">↻</span>
            <span><strong>잠깐 복습할까요?</strong><small>틀렸거나 저장한 항목이 있어요.</small></span>
            <b aria-hidden="true">→</b>
          </Link>
        )}

        <section className="course-section">
          <div className="home-section-heading">
            <div><span>나에게 맞게</span><h2>어떤 일본어를 배우고 싶나요?</h2></div>
          </div>
          <div className="course-grid">
            {learningCourses.map((course) => (
              <Link key={course.title} href={course.href} className={`course-card course-${course.tone}`}>
                <small>{course.eyebrow}</small>
                <h3>{course.title}</h3>
                <p>{course.desc}</p>
                <b>학습하기 →</b>
              </Link>
            ))}
          </div>
        </section>

        <section className="secondary-links">
          <p>학습 기록과 전체 기능</p>
          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <Link href="/language/progress">진도 보기</Link>
            <Link href="/language/calendar">달력 보기</Link>
            <Link href="/language/settings">설정</Link>
          </div>
        </section>

        <section className="practice-section">
          <h2>더 연습하고 싶다면</h2>
          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {practicalPractice.map((item) => (
              <article key={item.id} className="practice-card">
                <div>
                  <div className="practice-title">{item.title}</div>
                  <p className="muted" style={{ margin: "0 0 8px" }}>
                    {item.desc}
                  </p>
                  <p className="muted" style={{ margin: 0, fontSize: "13px" }}>
                    추천 시간: {item.duration}
                  </p>
                </div>
                <div>
                  <Link href={item.href} className="practice-link">
                    {item.cta}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
