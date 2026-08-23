"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  GRAMMAR_LESSONS,
  GRAMMAR_PROGRESS_KEY,
  type GrammarCategory,
  type GrammarLesson,
  type GrammarProgressItem,
} from "@/data/grammar";
import { markTodayRoutineCompleted } from "@/utils/dailyRoutineProgress";
import { speakJapaneseWithPreferredTts } from "@/utils/speakJapanese";

type GrammarFilter = "전체" | GrammarCategory;

function normalizeChoice(choice: string | { text: string; reading?: string; rubySegments?: { text: string; reading?: string }[] }) {
  if (typeof choice === "string") return { text: choice };
  return choice;
}

export default function GrammarPage() {
  const [filter, setFilter] = useState<GrammarFilter>("전체");
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [grammarProgress, setGrammarProgress] = useState<GrammarProgressItem[]>([]);



  useEffect(() => {
    try {
      const raw = localStorage.getItem(GRAMMAR_PROGRESS_KEY);
      if (!raw) {
        setGrammarProgress([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setGrammarProgress([]);
        return;
      }
      setGrammarProgress(parsed as GrammarProgressItem[]);
    } catch {
      setGrammarProgress([]);
    }
  }, []);

  const saveGrammarProgress = (next: GrammarProgressItem[]) => {
    setGrammarProgress(next);
    try {
      localStorage.setItem(GRAMMAR_PROGRESS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const visibleLessons = useMemo(
    () => (filter === "전체" ? GRAMMAR_LESSONS : GRAMMAR_LESSONS.filter((l) => l.category === filter)),
    [filter],
  );

  const handleSelectAnswer = (lesson: GrammarLesson, choice: string) => {
    if (selectedAnswers[lesson.id]) {
      return;
    }

    setSelectedAnswers((prev) => ({ ...prev, [lesson.id]: choice }));

    const isCorrect = choice === lesson.quiz.answer;
    const now = new Date().toISOString();
    const existing = grammarProgress.find((item) => item.lessonId === lesson.id);
    const nextItem: GrammarProgressItem = existing
      ? {
          ...existing,
          title: lesson.title,
          category: lesson.category,
          pattern: lesson.pattern,
          correctCount: existing.correctCount + (isCorrect ? 1 : 0),
          wrongCount: existing.wrongCount + (isCorrect ? 0 : 1),
          lastAnsweredAt: now,
          lastResult: isCorrect ? "correct" : "wrong",
        }
      : {
          lessonId: lesson.id,
          title: lesson.title,
          category: lesson.category,
          pattern: lesson.pattern,
          correctCount: isCorrect ? 1 : 0,
          wrongCount: isCorrect ? 0 : 1,
          lastAnsweredAt: now,
          lastResult: isCorrect ? "correct" : "wrong",
        };

    const nextProgress = existing
      ? grammarProgress.map((item) => (item.lessonId === lesson.id ? nextItem : item))
      : [...grammarProgress, nextItem];

    saveGrammarProgress(nextProgress);
    markTodayRoutineCompleted("grammar");
  };

  const resetLessonQuiz = (lessonId: string) => {
    setSelectedAnswers((prev) => {
      const next = { ...prev };
      delete next[lessonId];
      return next;
    });
  };

  const handleSpeak = (text: string) => {
    void speakJapaneseWithPreferredTts(text, {
      rate: 0.9,
      pitch: 1,
    }).catch((error) => {
      console.error("예문 듣기 처리 중 오류가 발생했습니다.", error);
    });
  };

  return (
    <section>
      <div
        style={{
          marginBottom: "20px",
          padding: "20px",
          borderRadius: "20px",
          background: "linear-gradient(135deg, #eff6ff 0%, #ffffff 72%)",
          border: "1px solid #dbeafe",
          boxShadow: "0 10px 24px rgba(37, 99, 235, 0.08)",
        }}
      >
        <h1 style={{ fontSize: "28px", margin: "0 0 8px", color: "#1e3a8a" }}>문법 기초</h1>
        <p className="muted" style={{ margin: 0, fontSize: "15px", lineHeight: 1.6 }}>
          기초 문법을 예문과 문제로 익혀보세요. 핵심 패턴부터 퀴즈까지 한 번에 연습할 수 있어요.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "18px",
          padding: "12px",
          borderRadius: "16px",
          border: "1px solid #e2e8f0",
          background: "#f8fbff",
        }}
      >
        {(["전체", "です/ます", "조사", "지시어", "기타"] as const).map((item) => {
          const isActive = filter === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              style={{
                border: isActive ? "1px solid #2563eb" : "1px solid #cbd5e1",
                borderRadius: "999px",
                padding: "9px 14px",
                fontSize: "13px",
                fontWeight: 700,
                background: isActive ? "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)" : "#ffffff",
                color: isActive ? "#ffffff" : "#334155",
                cursor: "pointer",
                boxShadow: isActive ? "0 8px 18px rgba(37, 99, 235, 0.22)" : "none",
              }}
            >
              {item}
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
        {visibleLessons.map((lesson) => {
          const selectedAnswer = selectedAnswers[lesson.id];
          const isCorrect = selectedAnswer === lesson.quiz.answer;
          const progressItem = grammarProgress.find((item) => item.lessonId === lesson.id);
          const progressText = progressItem
            ? `진도: 정답 ${progressItem.correctCount}회 · 오답 ${progressItem.wrongCount}회`
            : "진도: 아직 풀지 않음";
          const recentText = progressItem
            ? `최근: ${progressItem.lastResult === "correct" ? "정답" : "오답"}`
            : "최근: -";

          return (
            <article
              key={lesson.id}
              className="card"
              style={{
                padding: "16px",
                display: "grid",
                gap: "12px",
                borderRadius: "18px",
                border: "1px solid #dbeafe",
                boxShadow: "0 10px 22px rgba(15, 23, 42, 0.06)",
                background: "#ffffff",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                <h2 style={{ fontSize: "18px", margin: 0 }}>{lesson.title}</h2>
                <span style={{ fontSize: "12px", fontWeight: 700, borderRadius: "999px", border: "1px solid #bfdbfe", padding: "4px 10px", color: "#1d4ed8", background: "#eff6ff" }}>{lesson.category}</span>
              </div>
              <p className="muted" style={{ margin: 0 }}>{lesson.summary}</p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "12px" }}>
                <span style={{ border: "1px solid #dbeafe", borderRadius: "999px", padding: "4px 8px", background: "#f8fbff" }}>{progressText}</span>
                <span style={{ border: "1px solid #dbeafe", borderRadius: "999px", padding: "4px 8px", background: "#f8fbff" }}>{recentText}</span>
              </div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e3a8a" }}>핵심 패턴: {lesson.pattern}</div>
              <p className="muted" style={{ margin: 0, fontSize: "14px", lineHeight: 1.5 }}>{lesson.explanation}</p>

              <div style={{ display: "grid", gap: "8px", borderRadius: "14px", border: "1px solid #e2e8f0", background: "#fcfdff", padding: "10px" }}>
                {lesson.examples.map((e) => (
                  <div key={`${lesson.id}-${e.japanese}`} style={{ fontSize: "14px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                      <span>{e.japanese}</span>
                      <button type="button" onClick={() => handleSpeak(e.japanese)} style={{ border: "1px solid #bfdbfe", borderRadius: "10px", padding: "6px 11px", background: "#eff6ff", cursor: "pointer", fontSize: "12px", fontWeight: 700, color: "#1d4ed8" }}>예문 듣기</button>
                    </div>
                    <div className="muted">{e.meaning}</div>
                    {e.reading && <div style={{ marginTop: "2px", color: "#64748b", fontSize: "13px" }}>읽는 법: {e.reading}</div>}
                  </div>
                ))}
              </div>

              {lesson.sentencePattern && (
                <div>
                  <Link
                    href={`/language/sentences?pattern=${encodeURIComponent(lesson.sentencePattern)}`}
                    style={{
                      display: "inline-block",
                      border: "1px solid #fb923c",
                      borderRadius: "10px",
                      padding: "9px 14px",
                      background: "#fff7ed",
                      color: "#9a3412",
                      fontSize: "13px",
                      fontWeight: 700,
                      textDecoration: "none",
                    }}
                  >
                    관련 문장 학습
                  </Link>
                </div>
              )}

              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "12px", display: "grid", gap: "10px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e3a8a" }}>연습 문제</div>
                <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.55 }}>{lesson.quiz.question}</p>
                <div style={{ display: "grid", gap: "8px" }}>
                  {lesson.quiz.choices.map((rawChoice) => {
                    const choice = normalizeChoice(rawChoice);
                    const isAnswer = choice.text === lesson.quiz.answer;
                    const isSelected = selectedAnswer === choice.text;
                    const answered = Boolean(selectedAnswer);

                    let background = "#ffffff";
                    let border = "1px solid #cbd5e1";
                    let color = "#111827";

                    if (answered && isAnswer) {
                      background = "#dcfce7";
                      border = "1px solid #16a34a";
                      color = "#166534";
                    } else if (answered && isSelected && !isAnswer) {
                      background = "#fee2e2";
                      border = "1px solid #ef4444";
                      color = "#991b1b";
                    } else if (answered) {
                      background = "#f9fafb";
                      color = "#6b7280";
                    }

                    return (
                      <button
                        key={`${lesson.id}-${choice.text}`}
                        type="button"
                        onClick={() => handleSelectAnswer(lesson, choice.text)}
                        disabled={answered}
                        style={{
                          width: "100%",
                          minHeight: "44px",
                          padding: "10px 12px",
                          textAlign: "left",
                          border,
                          borderRadius: "12px",
                          background,
                          color,
                          cursor: answered ? "default" : "pointer",
                          fontWeight: 600,
                        }}
                      >
                        {choice.text}
                      </button>
                    );
                  })}
                </div>

                {selectedAnswer && (
                  <div
                    style={{
                      marginTop: "4px",
                      borderRadius: "12px",
                      padding: "10px 12px",
                      fontSize: "13px",
                      fontWeight: 700,
                      background: isCorrect ? "#ecfdf5" : "#fff7ed",
                      border: isCorrect ? "1px solid #86efac" : "1px solid #fdba74",
                      color: isCorrect ? "#166534" : "#9a3412",
                    }}
                  >
                    <div>{isCorrect ? "정답이에요!" : `아쉬워요. 정답은 ${lesson.quiz.answer} 입니다.`}</div>
                    {lesson.quiz.explanation && <div style={{ marginTop: "4px" }}>{lesson.quiz.explanation}</div>}
                  </div>
                )}

                {selectedAnswer && (
                  <button
                    type="button"
                    onClick={() => resetLessonQuiz(lesson.id)}
                    style={{
                      width: "fit-content",
                      border: "1px solid #93c5fd",
                      borderRadius: "10px",
                      padding: "8px 13px",
                      background: "#eff6ff",
                      color: "#1d4ed8",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 700,
                    }}
                  >
                    다시 풀기
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

