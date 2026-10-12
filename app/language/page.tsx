"use client";

import Link from "next/link";
import { useMemo } from "react";
import { getLocalDateKey } from "@/utils/dateKey";
import { useLanguageRecordSnapshot } from "@/components/language/useLanguageRecordSnapshot";
import { useLanguageMutationAction } from "@/components/language/useLanguageMutationAction";
import { planRoutineChange, projectRoutineDay, type RoutineId } from "@/app/data/languageDailyMutations";
import { projectLegacyRows } from "@/app/data/languageLegacyMutations";
import LearningWelcome from "@/components/language/LearningWelcome";
import YeoniAdviceEntry from "@/components/YeoniAdviceEntry";
import LiveOverview from "@/components/language/live/LiveOverview";

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

export default function HomePage() {
  const source = useLanguageRecordSnapshot(['dailyRoutineProgress', 'dailyLearningHistory']);
  const todayKey = useMemo(() => getLocalDateKey(), []);
  const mutation = useLanguageMutationAction(source, planRoutineChange, { strictSource: true, date: todayKey });
  const dailyProjection = projectRoutineDay(source.records, todayKey);
  const completedIds = dailyProjection.completedIds;
  const grammar = projectLegacyRows<{ lessonId: string; wrongCount: number; lastResult?: string }>(source.records.grammarProgress, (item): item is { lessonId: string; wrongCount: number; lastResult?: string } => !!item && typeof item === 'object' && typeof (item as { lessonId?: unknown }).lessonId === 'string' && typeof (item as { wrongCount?: unknown }).wrongCount === 'number');
  const hasGrammarWrong = grammar.value.some(item => item.wrongCount > 0 || item.lastResult === 'wrong');
  const recommendations = (['wrongKana', 'wrongKanaChars', 'wrongWords', 'wrongSentences', 'savedWords', 'savedSentences'] as const).map(key => projectLegacyRows<unknown>(source.records[key], (item): item is unknown => key === 'wrongKanaChars' ? typeof item === 'string' : !!item && typeof item === 'object' && typeof (item as Record<string, unknown>)[key === 'wrongKana' ? 'char' : key.endsWith('Words') ? 'word' : 'japanese'] === 'string'));
  const reviewCount = recommendations.reduce((total, projection) => total + projection.value.length, 0);
  const readError = dailyProjection.error || grammar.error || recommendations.find(projection => projection.error)?.error;
  const recommendation = { hasGrammarWrong, hasReviewItems: hasGrammarWrong || reviewCount > 0 };
  const hasLoadedRoutine = !!source.snapshot && !!source.context;
  const completedCount = completedIds.length;
  const toggleCompleted = (id: string) => {
    if (!hasLoadedRoutine || mutation.pending) return;
    void mutation.submit({ id: id as RoutineId, mode: 'toggle' });
  };

  return (
    <section className="home-page">
      <div className="home-container">
        {(mutation.error || source.error || readError) && <p role="alert">{mutation.error || source.error || readError}</p>}
        {mutation.pending && <div role="status">완료 변경을 확인하고 있어요. <button disabled={mutation.busy} onClick={() => void mutation.retry()}>저장 다시 확인</button> {mutation.canResubmit && <button disabled={mutation.busy} onClick={() => void mutation.resubmit()}>최신 상태에서 새로 저장</button>} <button disabled={mutation.busy} onClick={() => mutation.discard()}>보류한 변경 버리기</button></div>}
        <LearningWelcome />
        <YeoniAdviceEntry scope="language" />
        <LiveOverview />

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
                    disabled={!hasLoadedRoutine || mutation.pending}
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
