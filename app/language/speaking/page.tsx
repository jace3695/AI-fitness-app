"use client";

import { useState, useEffect } from "react";
import FuriganaText from "@/components/FuriganaText";
import type { RubySegment } from "@/data/sentences";

type Question = {
  korean: string;
  japanese: string;
  category: string;
  note?: string;
  reading?: string;
  koreanPronunciation?: string;
  rubySegments?: RubySegment[];
};

type SavedSentence = {
  japanese: string;
  meaning: string;
  category: string;
  note?: string;
  reading?: string;
  koreanPronunciation?: string;
  rubySegments?: RubySegment[];
};

const BASE_QUESTIONS: Question[] = [
  {
    korean: "이거 얼마예요?",
    japanese: "これはいくらですか？",
    category: "여행",
    reading: "これはいくらですか",
    koreanPronunciation: "코레와 이쿠라데스카",
  },
  {
    korean: "확인 부탁드립니다",
    japanese: "ご確認お願いします",
    category: "업무",
    reading: "ごかくにんおねがいします",
    rubySegments: [{ text: "ご" }, { text: "確認", reading: "かくにん" }, { text: "お願いします" }],
    koreanPronunciation: "고카쿠닌 오네가이시마스",
  },
  {
    korean: "지금 뭐 해?",
    japanese: "今何してる？",
    category: "친구",
    reading: "いまなにしてる？",
    rubySegments: [{ text: "今", reading: "いま" }, { text: "何", reading: "なに" }, { text: "してる？" }],
    koreanPronunciation: "이마 나니 시테루",
  },
  {
    korean: "같이 가자",
    japanese: "一緒に行こう",
    category: "친구",
    reading: "いっしょにいこう",
    rubySegments: [{ text: "一緒", reading: "いっしょ" }, { text: "に" }, { text: "行", reading: "い" }, { text: "こう" }],
    koreanPronunciation: "잇쇼니 이코오",
  },
  {
    korean: "천천히 말해 주세요",
    japanese: "ゆっくり話してください",
    category: "여행",
    reading: "ゆっくりはなしてください",
    rubySegments: [{ text: "ゆっくり" }, { text: "話", reading: "はな" }, { text: "してください" }],
    koreanPronunciation: "윳쿠리 하나시테 쿠다사이",
  },
];

const CATEGORIES = ["전체", "여행", "업무", "친구", "일상"];
const APP_SETTINGS_KEY = "japaneseAppSettings";

type AppSettings = {
  ttsRate: number;
  repeatCount: number;
  repeatDelayMs: number;
  showKoreanPronunciation: boolean;
  showReading: boolean;
};
type SettingsPayload = Partial<AppSettings> & {
  sections?: {
    speaking?: Partial<AppSettings>;
  };
};

const DEFAULT_SETTINGS: AppSettings = {
  ttsRate: 1,
  repeatCount: 1,
  repeatDelayMs: 500,
  showKoreanPronunciation: true,
  showReading: true,
};
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function speakJapaneseFallback(text: string, settings: AppSettings) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  for (let i = 0; i < settings.repeatCount; i += 1) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = settings.ttsRate;
    await new Promise<void>((resolve) => {
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
    if (i < settings.repeatCount - 1 && settings.repeatDelayMs > 0) {
      await wait(settings.repeatDelayMs);
    }
  }
}

async function speakJapanese(text: string, settings: AppSettings) {
  try {
    const res = await fetch("/api/language/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("TTS API error");
    const { audioContent } = await res.json();
    if (!audioContent) throw new Error("No audioContent");

    for (let i = 0; i < settings.repeatCount; i += 1) {
      const audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
      audio.playbackRate = settings.ttsRate;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("Audio playback failed"));
        audio.play().catch(reject);
      });
      if (i < settings.repeatCount - 1 && settings.repeatDelayMs > 0) {
        await wait(settings.repeatDelayMs);
      }
    }
  } catch {
    await speakJapaneseFallback(text, settings);
  }
}

export default function SpeakingPage() {
  const [allQuestions, setAllQuestions] = useState<Question[]>(BASE_QUESTIONS);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeCategory, setActiveCategory] = useState("전체");
  const [filtered, setFiltered] = useState<Question[]>(BASE_QUESTIONS);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"think" | "counting" | "answer" | "done">("think");
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState({ correct: 0, wrong: 0 });
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(APP_SETTINGS_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as SettingsPayload;
      const sectionSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        ...(parsed.sections?.speaking ?? {}),
      };
      setSettings({
        ttsRate: sectionSettings.ttsRate,
        repeatCount: sectionSettings.repeatCount,
        repeatDelayMs: sectionSettings.repeatDelayMs,
        showKoreanPronunciation: sectionSettings.showKoreanPronunciation,
        showReading: sectionSettings.showReading,
      });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("savedSentences");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        const saved: SavedSentence[] = Array.isArray(parsed) ? (parsed as SavedSentence[]) : [];
        const converted: Question[] = saved.map((s) => ({
          korean: s.meaning,
          japanese: s.japanese,
          category: s.category || "일상",
          note: s.note,
          reading: s.reading,
          koreanPronunciation: s.koreanPronunciation,
          rubySegments: s.rubySegments,
        }));
        setAllQuestions([...BASE_QUESTIONS, ...converted]);
      }
    } catch {
      // ignore
      setAllQuestions(BASE_QUESTIONS);
    }
  }, []);

  useEffect(() => {
    const result =
      activeCategory === "전체"
        ? allQuestions
        : allQuestions.filter((q) => q.category === activeCategory);
    setFiltered(result.length > 0 ? result : allQuestions);
    setIndex(0);
    setPhase("think");
    setCountdown(3);
    setAnswered(false);
    setScore({ correct: 0, wrong: 0 });
  }, [activeCategory, allQuestions]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (phase === "counting" && countdown > 0) {
      timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    } else if (phase === "counting" && countdown === 0) {
      setPhase("answer");
    }
    return () => clearTimeout(timer);
  }, [phase, countdown]);

  const current = filtered[index];

  const handleStartCountdown = () => {
    setCountdown(3);
    setPhase("counting");
  };

  const handleShowAnswer = () => {
    setPhase("answer");
  };

  const handleMark = (correct: boolean) => {
    setScore((s) => ({
      correct: s.correct + (correct ? 1 : 0),
      wrong: s.wrong + (correct ? 0 : 1),
    }));
    setAnswered(true);
  };

  const handleNext = () => {
    const nextIndex = index + 1;
    if (nextIndex >= filtered.length) {
      setPhase("done");
    } else {
      setIndex(nextIndex);
      setPhase("think");
      setCountdown(3);
      setAnswered(false);
    }
  };

  const handleRestart = () => {
    setIndex(0);
    setPhase("think");
    setCountdown(3);
    setAnswered(false);
    setScore({ correct: 0, wrong: 0 });
  };

  if (phase === "done") {
    const total = filtered.length;
    return (
      <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1rem", width: "100%" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1.5rem" }}>
          🎉 훈련 완료!
        </h1>
        <div
          style={{
            background: "#f5f5f5",
            borderRadius: 12,
            padding: "1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#333" }}>
            총 문제 수: <strong>{total}</strong>
          </div>
          <div style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#16a34a" }}>
            ✅ 맞은 개수: <strong>{score.correct}</strong>
          </div>
          <div style={{ fontSize: "1rem", color: "#dc2626" }}>
            ❌ 틀린 개수: <strong>{score.wrong}</strong>
          </div>
        </div>
        <button onClick={handleRestart} style={btnStyle("#4f46e5", "#fff")}>
          🔄 다시 시작
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1rem", width: "100%" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>
        말하기 훈련
      </h1>

      {/* 카테고리 필터 */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              background: activeCategory === cat ? "#4f46e5" : "#e5e7eb",
              color: activeCategory === cat ? "#fff" : "#333",
              border: "none",
              borderRadius: 20,
              padding: "0.35rem 0.85rem",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "1.5rem" }}>
        {index + 1} / {filtered.length} &nbsp;|&nbsp; ✅ {score.correct} &nbsp;❌ {score.wrong}
      </div>

      <div
        style={{
          background: "#f5f5f5",
          borderRadius: 12,
          padding: "1.5rem",
          marginBottom: "1.5rem",
          width: "100%",
        }}
      >
        <span
          style={{
            display: "inline-block",
            background: "#e0e7ff",
            color: "#3730a3",
            borderRadius: 6,
            padding: "2px 10px",
            fontSize: "0.78rem",
            fontWeight: 600,
            marginBottom: "0.75rem",
          }}
        >
          {current.category}
        </span>
        <p style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>{current.korean}</p>
        {current.note && (
          <p style={{ fontSize: "0.8rem", color: "#888", marginTop: "0.5rem", marginBottom: 0 }}>
            {current.note}
          </p>
        )}
      </div>

      {phase === "think" && (
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            onClick={handleStartCountdown}
            style={btnStyle("#4f46e5", "#fff")}
          >
            ⏳ 3초 생각하기
          </button>
          <button
            onClick={handleShowAnswer}
            style={btnStyle("#e5e7eb", "#111")}
          >
            정답 보기
          </button>
        </div>
      )}

      {phase === "counting" && (
        <div style={{ textAlign: "center", padding: "1rem 0" }}>
          <div
            style={{
              fontSize: "4rem",
              fontWeight: 800,
              color: "#4f46e5",
              lineHeight: 1,
            }}
          >
            {countdown}
          </div>
          <p style={{ color: "#666", marginTop: "0.5rem" }}>생각하세요…</p>
          <button
            onClick={handleShowAnswer}
            style={{ ...btnStyle("#e5e7eb", "#111"), marginTop: "1rem" }}
          >
            정답 보기
          </button>
        </div>
      )}

      {phase === "answer" && (
        <>
          <div
            style={{
              background: "#ecfdf5",
              border: "1px solid #6ee7b7",
              borderRadius: 12,
              padding: "1.25rem",
              marginBottom: "1rem",
            }}
          >
            <p style={{ fontSize: "0.78rem", color: "#065f46", marginBottom: "0.25rem" }}>
              정답
            </p>
            <p style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, marginBottom: settings.showKoreanPronunciation && current.koreanPronunciation ? "0.5rem" : 0 }}>
              <FuriganaText
                text={current.japanese}
                reading={current.reading}
                rubySegments={current.rubySegments}
                showReading={settings.showReading}
              />
            </p>
            {settings.showKoreanPronunciation && current.koreanPronunciation && (
              <p style={{ fontSize: "0.85rem", color: "#3d8a6a", margin: 0, lineHeight: 1.5, wordBreak: "break-word" }}>
                {current.koreanPronunciation}
              </p>
            )}
          </div>

          <button
            onClick={() => speakJapanese(current.japanese, settings)}
            style={{ ...btnStyle("#0891b2", "#fff"), marginBottom: "1rem" }}
          >
            🔊 정답 듣기
          </button>

          {!answered ? (
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={() => handleMark(true)}
                style={btnStyle("#16a34a", "#fff")}
              >
                ✅ 맞았음
              </button>
              <button
                onClick={() => handleMark(false)}
                style={btnStyle("#dc2626", "#fff")}
              >
                ❌ 틀렸음
              </button>
            </div>
          ) : (
            <button onClick={handleNext} style={btnStyle("#4f46e5", "#fff")}>
              {index + 1 >= filtered.length ? "결과 보기 →" : "다음 문제 →"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function btnStyle(bg: string, color: string): React.CSSProperties {
  return {
    background: bg,
    color,
    border: "none",
    borderRadius: 8,
    padding: "0.65rem 1.25rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    cursor: "pointer",
  };
}

