"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

import { markTodayRoutineCompleted } from "@/utils/dailyRoutineProgress";
import { SENTENCES, type SentenceItem as Sentence } from "@/data/sentences";
import { speakJapaneseWithPreferredTts } from "@/utils/speakJapanese";
import WritingPracticePad from "@/components/WritingPracticePad";

const STORAGE_KEY = "savedSentences";
const WRONG_SENTENCES_KEY = "wrongSentences";

type Category = "전체" | "여행" | "업무" | "친구" | "일상";
type LevelFilter = "all" | "beginner" | "basic" | "practical";
type PatternFilter =
  | "all"
  | "desu"
  | "masu"
  | "particle-wa"
  | "particle-wo"
  | "particle-ni"
  | "particle-de"
  | "question"
  | "travel"
  | "work"
  | "daily"
  | "request"
  | "shopping"
  | "direction"
  | "other";
type Mode = "학습" | "퀴즈";
type QuizType = "jp-to-kr" | "kr-to-jp";

interface QuizState {
  question: Sentence;
  choices: string[];
  quizType: QuizType;
  selected: string | null;
  isCorrect: boolean | null;
}

type AppSettings = {
  ttsRate: number;
  repeatCount: number;
  repeatDelayMs: number;
  showKoreanPronunciation: boolean;
  showReading: boolean;
};
type SettingsPayload = Partial<AppSettings> & {
  sections?: {
    sentences?: Partial<AppSettings>;
  };
};

const APP_SETTINGS_KEY = "japaneseAppSettings";
const DEFAULT_SETTINGS: AppSettings = {
  ttsRate: 0.9,
  repeatCount: 1,
  repeatDelayMs: 500,
  showKoreanPronunciation: true,
  showReading: true,
};
const sentencePatternLabels: Record<string, string> = {
  desu: "です 문장",
  masu: "ます 문장",
  "particle-wa": "は 패턴",
  "particle-wo": "を 패턴",
  "particle-ni": "に 패턴",
  "particle-de": "で 패턴",
  question: "질문 표현",
  travel: "여행 표현",
  work: "업무 표현",
  daily: "일상 표현",
  request: "요청 표현",
  shopping: "쇼핑 표현",
  direction: "길찾기 표현",
  other: "기타",
};

async function speakJapanese(text: string, settings: AppSettings) {
  await speakJapaneseWithPreferredTts(text, {
    rate: settings.ttsRate,
    pitch: 1,
    repeatCount: settings.repeatCount,
    repeatDelayMs: settings.repeatDelayMs,
  });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateQuiz(pool: Sentence[]): QuizState {
  const shuffled = shuffle(pool);
  const question = shuffled[0];
  const quizType: QuizType = Math.random() < 0.5 ? "jp-to-kr" : "kr-to-jp";

  const wrongCandidates = shuffled.slice(1);
  const wrongs = shuffle(wrongCandidates).slice(0, 3);

  let correctAnswer: string;
  let wrongAnswers: string[];

  if (quizType === "jp-to-kr") {
    correctAnswer = question.meaning;
    wrongAnswers = wrongs.map((s) => s.meaning);
  } else {
    correctAnswer = question.japanese;
    wrongAnswers = wrongs.map((s) => s.japanese);
  }

  const choices = shuffle([correctAnswer, ...wrongAnswers]);

  return {
    question,
    choices,
    quizType,
    selected: null,
    isCorrect: null,
  };
}

function getEffectiveLevel(sentence: Sentence): Exclude<LevelFilter, "all"> {
  return sentence.level ?? "beginner";
}

const KANJI_REGEX = /[一-龯々]/;

function resolveReadingForDisplay(sentence: Sentence): string | undefined {
  const readingFromRubySegments = sentence.rubySegments
    ?.map((segment) => {
      const raw = (segment.reading ?? segment.text).trim();
      if (KANJI_REGEX.test(raw)) return "";
      return raw;
    })
    .join("")
    .trim();

  const reading = (sentence.reading?.trim() || readingFromRubySegments || "").trim();
  if (!reading) return undefined;
  if (reading === "준비 중") return undefined;
  if (reading === sentence.japanese.trim()) return undefined;
  return reading;
}


function resolveSentenceTtsText(sentence: Sentence): string {
  return resolveReadingForDisplay(sentence) ?? sentence.japanese;
}
function JapaneseTextBlock({
  japanese,
  reading,
  isReadingExpanded,
  onToggleReading,
  koreanPronunciation,
  showKoreanPronunciation,
}: {
  japanese: string;
  reading?: string;
  isReadingExpanded: boolean;
  onToggleReading: () => void;
  koreanPronunciation?: string;
  showKoreanPronunciation: boolean;
}) {
  return (
    <div style={{ lineHeight: 1.5 }}>
      <div className="jp-text" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{japanese}</div>
      {reading && (
        <div style={{ marginTop: "4px" }}>
          <button
            type="button"
            onClick={onToggleReading}
            className="btn"
            style={{
              padding: "2px 8px",
              fontSize: "12px",
              color: "#475569",
              background: "#f8fafc",
              borderColor: "#e2e8f0",
            }}
          >
            {isReadingExpanded ? "읽는 법 숨기기" : "읽는 법 보기"}
          </button>
          {isReadingExpanded && (
            <div style={{ marginTop: "4px", color: "#64748b", fontSize: "12px" }}>읽는 법: {reading}</div>
          )}
        </div>
      )}
      {showKoreanPronunciation && koreanPronunciation && (
        <div style={{ marginTop: "2px", color: "#7b867b", fontSize: "13px" }}>한글 발음: {koreanPronunciation}</div>
      )}
    </div>
  );
}

export default function SentencesPage() {
  const router = useRouter();
  const [savedSentences, setSavedSentences] = useState<Sentence[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<Mode>("학습");
  const [category, setCategory] = useState<Category>("전체");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [patternFilter, setPatternFilter] = useState<PatternFilter>("all");
  const [wordFilter, setWordFilter] = useState("");
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [expandedReadingKeys, setExpandedReadingKeys] = useState<Set<string>>(new Set());
  const [writingTargetKey, setWritingTargetKey] = useState<string | null>(null);
  const practicePadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const queryPattern = new URLSearchParams(window.location.search).get("pattern");
    if (!queryPattern) return;
    const validPatterns: PatternFilter[] = [
      "desu","masu","particle-wa","particle-wo","particle-ni","particle-de","question","travel","work","daily","request","shopping","direction","other",
    ];
    if (validPatterns.includes(queryPattern as PatternFilter)) {
      setPatternFilter(queryPattern as PatternFilter);
      return;
    }
    setPatternFilter("all");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const queryWord = new URLSearchParams(window.location.search).get("word")?.trim() ?? "";
    setWordFilter(queryWord);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(APP_SETTINGS_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as SettingsPayload;
      const sectionSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        ...(parsed.sections?.sentences ?? {}),
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
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        setSavedSentences(Array.isArray(parsed) ? (parsed as Sentence[]) : []);
      }
    } catch {
      // 무시
      setSavedSentences([]);
    }
  }, []);

  const filteredSentences = SENTENCES.filter(
    (s) => category === "전체" || s.category === category
  );

  const filteredSentencesByLevel = filteredSentences.filter(
    (s) => levelFilter === "all" || getEffectiveLevel(s) === levelFilter
  );
  const filteredSentencesByPattern = filteredSentencesByLevel.filter(
    (s) => patternFilter === "all" || (s.pattern ?? "other") === patternFilter
  );
  const filteredSentencesByWord = filteredSentencesByPattern.filter((s) => {
    if (!wordFilter) return true;
    return s.japanese.includes(wordFilter) || s.relatedWords?.some((word) => word.includes(wordFilter));
  });

  const startQuiz = useCallback(() => {
    const pool = SENTENCES.filter(
      (s) =>
        (category === "전체" || s.category === category) &&
        (levelFilter === "all" || getEffectiveLevel(s) === levelFilter) &&
        (patternFilter === "all" || (s.pattern ?? "other") === patternFilter)
    );
    if (pool.length < 4) return;
    setQuiz(generateQuiz(pool));
    setScore({ correct: 0, total: 0 });
  }, [category, levelFilter, patternFilter]);

  useEffect(() => {
    if (mode === "퀴즈") {
      startQuiz();
    }
  }, [mode, startQuiz]);

  const isSameSentence = (a: Sentence, b: Sentence) =>
    a.japanese === b.japanese &&
    a.meaning === b.meaning &&
    a.category === b.category;

  const getSentenceKey = (sentence: Sentence) => `${sentence.japanese}|${sentence.meaning}|${sentence.category}`;

  const handleWritingPracticeToggle = (sentence: Sentence) => {
    const targetKey = getSentenceKey(sentence);
    setWritingTargetKey((prev) => (prev === targetKey ? null : targetKey));
  };

  useEffect(() => {
    if (!writingTargetKey || mode !== "학습") return;
    const frame = window.requestAnimationFrame(() => {
      practicePadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [mode, writingTargetKey]);

  const isSaved = (s: Sentence) =>
    savedSentences.some((x) => isSameSentence(x, s));

  const handleSave = (s: Sentence) => {
    const next = isSaved(s)
      ? savedSentences.filter((x) => !isSameSentence(x, s))
      : [...savedSentences, s];

    setSavedSentences(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const saveWrongSentence = (q: QuizState) => {
    try {
      const raw = localStorage.getItem(WRONG_SENTENCES_KEY);
      const prev: Array<{
        japanese: string;
        reading?: string;
        meaning: string;
        category: string;
        note: string;
        quizType: QuizType;
        createdAt: string;
      }> = raw ? JSON.parse(raw) : [];

      const isDuplicate = prev.some(
        (x) => x.japanese === q.question.japanese && x.quizType === q.quizType
      );
      if (isDuplicate) return;

      const next = [
        ...prev,
        {
          japanese: q.question.japanese,
          reading: q.question.reading,
          rubySegments: q.question.rubySegments,
          meaning: q.question.meaning,
          category: q.question.category,
          note: q.question.note,
          quizType: q.quizType,
          createdAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem(WRONG_SENTENCES_KEY, JSON.stringify(next));
    } catch {
      // 무시
    }
  };

  const handleChoiceSelect = (choice: string) => {
    if (!quiz || quiz.selected !== null) return;

    const correctAnswer =
      quiz.quizType === "jp-to-kr"
        ? quiz.question.meaning
        : quiz.question.japanese;

    const isCorrect = choice === correctAnswer;

    const updatedQuiz = { ...quiz, selected: choice, isCorrect };
    setQuiz(updatedQuiz);
    setScore((prev) => {
      const nextTotal = prev.total + 1;
      if (nextTotal === 3) {
        markTodayRoutineCompleted("sentences");
      }
      return {
        correct: prev.correct + (isCorrect ? 1 : 0),
        total: nextTotal,
      };
    });

    if (!isCorrect) {
      saveWrongSentence(updatedQuiz);
    }
  };

  const handleNextQuiz = () => {
    const pool = SENTENCES.filter(
      (s) =>
        (category === "전체" || s.category === category) &&
        (levelFilter === "all" || getEffectiveLevel(s) === levelFilter) &&
        (patternFilter === "all" || (s.pattern ?? "other") === patternFilter)
    );
    if (pool.length < 4) return;
    setQuiz(generateQuiz(pool));
  };

  const CATEGORIES: Category[] = ["전체", "여행", "업무", "친구", "일상"];
  const LEVELS: Array<{ label: string; value: LevelFilter }> = [
    { label: "전체", value: "all" },
    { label: "기초", value: "beginner" },
    { label: "기본", value: "basic" },
    { label: "실전", value: "practical" },
  ];
  const PATTERNS: Array<{ label: string; value: PatternFilter }> = [
    { label: "전체 패턴", value: "all" },
    { label: "です 문장", value: "desu" },
    { label: "ます 문장", value: "masu" },
    { label: "は 패턴", value: "particle-wa" },
    { label: "を 패턴", value: "particle-wo" },
    { label: "に 패턴", value: "particle-ni" },
    { label: "で 패턴", value: "particle-de" },
    { label: "질문 표현", value: "question" },
    { label: "여행 표현", value: "travel" },
    { label: "업무 표현", value: "work" },
    { label: "일상 표현", value: "daily" },
    { label: "요청 표현", value: "request" },
    { label: "쇼핑 표현", value: "shopping" },
    { label: "길찾기 표현", value: "direction" },
    { label: "기타", value: "other" },
  ];

  const handlePatternFilterChange = (nextPattern: PatternFilter) => {
    setPatternFilter(nextPattern);
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (nextPattern === "all") {
      params.delete("pattern");
    } else {
      params.set("pattern", nextPattern);
    }
    const query = params.toString();
    router.replace(query ? `/language/sentences?${query}` : "/language/sentences");
  };

  return (
    <section className="mx-auto w-full max-w-6xl">
      <div
        style={{
          marginBottom: "18px",
          padding: "20px",
          borderRadius: "20px",
          border: "1px solid #dbeafe",
          background: "linear-gradient(135deg, #eff6ff 0%, #f8fbff 60%, #ffffff 100%)",
          boxShadow: "0 8px 20px rgba(59, 130, 246, 0.08)",
        }}
      >
        <h1 style={{ margin: 0, color: "#1e3a8a" }}>문장 학습</h1>
        <p className="muted" style={{ margin: "10px 0 0", color: "#475569", lineHeight: 1.6 }}>
          자주 쓰는 일본어 문장을 듣고, 저장하고, 퀴즈로 익혀보세요.{" "}
          <span style={{ color: "#1e3a8a", fontWeight: 700 }}>저장 {savedSentences.length}개</span>
        </p>
      </div>

      {/* 모드 전환 */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {(["학습", "퀴즈"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="btn"
            style={{
              fontWeight: mode === m ? 700 : 400,
              background: mode === m ? "#2563eb" : "#f8fafc",
              color: mode === m ? "#fff" : "#1e293b",
              borderColor: mode === m ? "#2563eb" : "#dbeafe",
              borderRadius: "999px",
            }}
          >
            {m} 모드
          </button>
        ))}
      </div>

      <div
        className="card"
        style={{
          marginBottom: "20px",
          borderRadius: "18px",
          border: "1px solid #dbeafe",
          background: "#ffffff",
          boxShadow: "0 8px 20px rgba(15, 23, 42, 0.05)",
        }}
      >
        <div style={{ fontWeight: 700, color: "#1e3a8a", marginBottom: "8px" }}>필터</div>
        <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px" }}>
          카테고리, 난이도, 문법 패턴으로 원하는 문장을 빠르게 찾을 수 있어요.
        </div>
        <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "6px" }}>카테고리</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className="btn"
            style={{
              fontSize: "13px",
              padding: "6px 12px",
              fontWeight: category === c ? 700 : 400,
              background: category === c ? "#2563eb" : "#f8fafc",
              color: category === c ? "#fff" : "#334155",
              borderColor: category === c ? "#2563eb" : "#dbeafe",
              borderRadius: "999px",
            }}
          >
            {c}
          </button>
        ))}
      </div>
      <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "6px" }}>문법 패턴</div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
        {PATTERNS.map((pattern) => (
          <button
            key={pattern.value}
            onClick={() => handlePatternFilterChange(pattern.value)}
            className="btn"
            style={{
              fontSize: "13px",
              padding: "6px 12px",
              fontWeight: patternFilter === pattern.value ? 700 : 400,
              background: patternFilter === pattern.value ? "#2563eb" : "#f8fafc",
              color: patternFilter === pattern.value ? "#fff" : "#334155",
              borderColor: patternFilter === pattern.value ? "#2563eb" : "#dbeafe",
              borderRadius: "999px",
            }}
          >
            {pattern.label}
          </button>
        ))}
      </div>
      <div className="card" style={{ marginBottom: "16px", fontSize: "13px", color: "#4b5563", background: "#f8fbff", borderColor: "#dbeafe" }}>
        <div><strong>です 문장:</strong> 명사나 상태를 공손하게 말할 때 사용해요. 예: これは水です。</div>
        <div><strong>ます 문장:</strong> 동작을 공손하게 말할 때 사용해요. 예: 日本語を勉強します。</div>
        <div><strong>は/を/に/で 패턴:</strong> 주제·대상·방향·장소를 나타내는 기본 조사 패턴이에요.</div>
        <div><strong>질문/요청 표현:</strong> 정보를 묻거나 부탁할 때 자주 사용해요.</div>
      </div>

      {/* 난이도 필터 */}
      <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "6px" }}>난이도</div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
        {LEVELS.map((level) => (
          <button
            key={level.value}
            onClick={() => setLevelFilter(level.value)}
            className="btn"
            style={{
              fontSize: "13px",
              padding: "6px 12px",
              fontWeight: levelFilter === level.value ? 700 : 400,
              background: levelFilter === level.value ? "#2563eb" : "#f8fafc",
              color: levelFilter === level.value ? "#fff" : "#334155",
              borderColor: levelFilter === level.value ? "#2563eb" : "#dbeafe",
              borderRadius: "999px",
            }}
          >
            {level.label}
          </button>
        ))}
      </div>
      </div>

      {/* 학습 모드 */}
      {mode === "학습" && (
        <div style={{
          marginTop: "24px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
          gap: "16px",
        }}>
          {wordFilter && (
            <div className="card" style={{ gridColumn: "1 / -1", padding: "12px 16px" }}>
              <div style={{ fontSize: "14px", color: "#444" }}>
                {patternFilter !== "all" ? `패턴: ${sentencePatternLabels[patternFilter]} · ` : ""}관련 단어: {wordFilter}
              </div>
              <div style={{ marginTop: "8px" }}>
                <button type="button" className="btn" onClick={() => router.replace("/language/sentences")}>전체 문장 보기</button>
              </div>
            </div>
          )}
          {filteredSentencesByWord.map((s) => {
            const saved = isSaved(s);
            const reading = settings.showReading ? resolveReadingForDisplay(s) : undefined;
            const readingKey = `${s.japanese}__${s.meaning}`;
            const isReadingExpanded = expandedReadingKeys.has(readingKey);
            return (
              <div key={s.japanese} className="card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  padding: "16px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "14px",
                  background: "#fff",
                  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
                }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <JapaneseTextBlock
                    japanese={s.japanese}
                    reading={reading}
                    isReadingExpanded={isReadingExpanded}
                    onToggleReading={() => {
                      setExpandedReadingKeys((prev) => {
                        const next = new Set(prev);
                        if (next.has(readingKey)) {
                          next.delete(readingKey);
                        } else {
                          next.add(readingKey);
                        }
                        return next;
                      });
                    }}
                    koreanPronunciation={s.koreanPronunciation}
                    showKoreanPronunciation={settings.showKoreanPronunciation}
                  />
                  <div>
                    <span className="badge" style={{ background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" }}>
                      문법 패턴: {sentencePatternLabels[s.pattern ?? "other"] ?? "기타"}
                    </span>
                  </div>
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div className="label">뜻</div>
                      <span className="badge" style={{ background: "#fff7ed", color: "#c2410c", borderColor: "#fed7aa" }}>{s.category}</span>
                    </div>
                    <div>{s.meaning}</div>
                  </div>

                  <div style={{ marginTop: "10px" }}>
                    <div className="label">설명</div>
                    <div style={{ color: "#555" }}>{s.note}</div>
                  </div>
                  {s.relatedWords && s.relatedWords.length > 0 && (
                    <div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {s.relatedWords.map((word) => (
                        <span
                          key={`${s.japanese}-${word}`}
                          className="badge"
                          style={{ background: "#f1f5f9", color: "#334155", borderColor: "#e2e8f0" }}
                        >
                          {word}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{
                  marginTop: "16px",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  justifyContent: "flex-end",
                  alignItems: "center",
                }}>
                  <button
                    onClick={() => speakJapanese(resolveSentenceTtsText(s), settings)}
                    className="btn"
                    type="button"
                    style={{ background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe", fontWeight: 600 }}
                  >
                    🔊 문장 듣기
                  </button>
                  <button
                    type="button"
                    onClick={() => handleWritingPracticeToggle(s)}
                    className="btn"
                    style={{ background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe", fontWeight: 600 }}
                  >
                    쓰기 연습
                  </button>
                  <button
                    onClick={() => handleSave(s)}
                    className="btn"
                    style={{
                      background: saved ? "#fff1f2" : "#2563eb",
                      color: saved ? "#be123c" : "#ffffff",
                      borderColor: saved ? "#fecdd3" : "#2563eb",
                      fontWeight: 700,
                    }}
                  >
                    {saved ? "저장 취소" : "저장"}
                  </button>
                </div>
                {mode === "학습" && writingTargetKey === getSentenceKey(s) && (
                  <div ref={practicePadRef}>
                    <WritingPracticePad
                      title="문장 쓰기 연습"
                      targetText={s.japanese}
                      reading={settings.showReading ? resolveReadingForDisplay(s) : undefined}
                      meaning={s.meaning}
                      helperText={settings.showKoreanPronunciation && s.koreanPronunciation ? `한글 발음: ${s.koreanPronunciation}` : "흐린 문장을 따라 써보세요. 마우스와 터치 모두 사용할 수 있어요."}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {filteredSentencesByWord.length === 0 && (
            <div style={{ color: "#888", textAlign: "center", padding: "32px 0" }}>
              {wordFilter ? "해당 단어가 포함된 문장이 아직 없습니다." : patternFilter !== "all" ? "해당 패턴의 문장이 아직 없습니다." : "해당 카테고리의 문장이 없습니다."}
              {(patternFilter !== "all" || wordFilter) && (
                <div style={{ marginTop: "12px" }}>
                  <button type="button" className="btn" onClick={() => router.replace("/language/sentences")}>
                    전체 문장 보기
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 퀴즈 모드 */}
      {mode === "퀴즈" && (
        <div>
          {/* 점수 */}
          <div
            className="card"
            style={{
              marginBottom: "16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontWeight: 600 }}>점수</span>
            <span style={{ fontSize: "18px", fontWeight: 700 }}>
              {score.correct} / {score.total}
            </span>
          </div>

          {filteredSentencesByPattern.length < 4 ? (
            <div
              className="card"
              style={{ textAlign: "center", color: "#888", padding: "32px 0" }}
            >
              퀴즈를 위해 해당 카테고리에 최소 4개의 문장이 필요합니다.
            </div>
          ) : quiz ? (
            <div className="card" style={{ borderColor: "#dbeafe", borderRadius: "16px", boxShadow: "0 6px 16px rgba(15, 23, 42, 0.06)" }}>
              {/* 문제 유형 */}
              <div style={{ marginBottom: "8px" }}>
                <span className="badge" style={{ background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" }}>
                  {quiz.quizType === "jp-to-kr"
                    ? "일본어 → 한국어"
                    : "한국어 → 일본어"}
                </span>
                <span className="badge" style={{ marginLeft: "6px", background: "#fef9c3", color: "#92400e", borderColor: "#fde68a" }}>
                  {sentencePatternLabels[quiz.question.pattern ?? "other"] ?? "기타"}
                </span>
              </div>

              {/* 문제 */}
              <div
                style={{
                  fontSize: quiz.quizType === "jp-to-kr" ? "22px" : "18px",
                  fontWeight: 700,
                  margin: "16px 0",
                  lineHeight: 1.4,
                }}
              >
                {quiz.quizType === "jp-to-kr"
                  ? quiz.question.japanese
                  : quiz.question.meaning}
              </div>
              {quiz.quizType === "jp-to-kr" && settings.showReading && resolveReadingForDisplay(quiz.question) && (
                <div style={{ marginTop: "-8px", marginBottom: "8px", color: "#64748b", fontSize: "13px" }}>
                  읽는 법: {resolveReadingForDisplay(quiz.question)}
                </div>
              )}
              {quiz.quizType === "jp-to-kr" && settings.showKoreanPronunciation && quiz.question.koreanPronunciation && (
                <div style={{ marginTop: "-8px", marginBottom: "12px", color: "#7b867b", fontSize: "13px" }}>
                  {quiz.question.koreanPronunciation}
                </div>
              )}

              {/* TTS (일본어 문제일 때) */}
              {quiz.quizType === "jp-to-kr" && (
                <div style={{ marginBottom: "16px" }}>
                  <button
                    className="btn"
                    onClick={() => speakJapanese(resolveSentenceTtsText(quiz.question), settings)}
                    type="button"
                    style={{ background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe", fontWeight: 600 }}
                  >
                    🔊 문장 듣기
                  </button>
                </div>
              )}

              {/* 보기 */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                  marginBottom: "16px",
                }}
              >
                {quiz.choices.map((choice, idx) => {
                  const correctAnswer =
                    quiz.quizType === "jp-to-kr"
                      ? quiz.question.meaning
                      : quiz.question.japanese;
                  const isSelected = quiz.selected === choice;
                  const isCorrectChoice = choice === correctAnswer;
                  const revealed = quiz.selected !== null;

                  let bg = "transparent";
                  let border = "1.5px solid #ddd";
                  let color = "#222";

                  if (revealed) {
                    if (isCorrectChoice) {
                      bg = "#d4f5d4";
                      border = "1.5px solid #4caf50";
                      color = "#1b5e20";
                    } else if (isSelected && !isCorrectChoice) {
                      bg = "#fde8e8";
                      border = "1.5px solid #e53935";
                      color = "#b71c1c";
                    }
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => handleChoiceSelect(choice)}
                      disabled={revealed}
                      style={{
                        padding: "12px 10px",
                        borderRadius: "8px",
                        border,
                        background: bg,
                        color,
                        fontWeight: isSelected || (revealed && isCorrectChoice) ? 700 : 400,
                        fontSize: "14px",
                        cursor: revealed ? "default" : "pointer",
                        textAlign: "left",
                        lineHeight: 1.4,
                        transition: "all 0.15s",
                      }}
                    >
                      <span style={{ opacity: 0.5, marginRight: "6px" }}>
                        {idx + 1}.
                      </span>
                      <span>{choice}</span>
                    </button>
                  );
                })}
              </div>

              {/* 정답/오답 피드백 */}
              {quiz.selected !== null && (
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: "8px",
                    background: quiz.isCorrect ? "#d4f5d4" : "#fde8e8",
                    color: quiz.isCorrect ? "#1b5e20" : "#b71c1c",
                    fontWeight: 600,
                    marginBottom: "14px",
                    fontSize: "15px",
                  }}
                >
                  {quiz.isCorrect ? "✓ 정답입니다!" : "✗ 오답입니다."}
                  {!quiz.isCorrect && (
                    <div style={{ fontWeight: 400, marginTop: "4px", fontSize: "13px" }}>
                      정답:{" "}
                      <strong>
                        {quiz.quizType === "jp-to-kr"
                          ? quiz.question.meaning
                          : quiz.question.japanese}
                      </strong>
                    </div>
                  )}
                  <div style={{ fontWeight: 400, marginTop: "4px", fontSize: "13px", opacity: 0.8 }}>
                    {quiz.question.note}
                  </div>
                  <div style={{ fontWeight: 400, marginTop: "4px", fontSize: "13px", opacity: 0.8 }}>
                    패턴: {sentencePatternLabels[quiz.question.pattern ?? "other"] ?? "기타"}
                  </div>
                </div>
              )}

              {/* 다음 문제 버튼 */}
              {quiz.selected !== null && (
                <button
                  className="btn"
                  onClick={handleNextQuiz}
                  style={{ fontWeight: 700, width: "100%" }}
                >
                  다음 문제
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

