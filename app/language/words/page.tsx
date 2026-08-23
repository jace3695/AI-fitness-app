"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

import { markTodayRoutineCompleted } from "@/utils/dailyRoutineProgress";
import { WORDS, type WordItem as Word } from "@/data/words";
import type { RubySegment } from "@/data/words";
import { speakJapaneseWithPreferredTts } from "@/utils/speakJapanese";
import WritingPracticePad from "@/components/WritingPracticePad";

const STORAGE_KEY = "savedWords";
const WRONG_WORDS_KEY = "wrongWords";
type CategoryFilter = "전체" | "여행" | "업무" | "일상" | "친구";
type LevelFilter = "all" | "beginner" | "basic" | "practical";
type PartOfSpeechFilter = "all" | "noun" | "verb" | "i-adjective" | "na-adjective" | "adverb" | "expression" | "particle" | "other";
type QuizType = "jp-to-kr" | "kr-to-jp";
type PageMode = "study" | "quiz";

type WrongWord = {
  word: string;
  reading?: string;
  rubySegments?: RubySegment[];
  meaning: string;
  example: string;
  exampleReading?: string;
  exampleRubySegments?: RubySegment[];
  category: Word["category"];
  quizType: QuizType;
  createdAt: string;
};

type AppSettings = {
  ttsRate: number;
  repeatCount: number;
  repeatDelayMs: number;
  showKoreanPronunciation: boolean;
  showReading: boolean;
};
type SettingsPayload = Partial<AppSettings> & {
  sections?: {
    words?: Partial<AppSettings>;
  };
};

const APP_SETTINGS_KEY = "japaneseAppSettings";

const partOfSpeechLabels: Record<Exclude<PartOfSpeechFilter, "all">, string> = {
  noun: "명사",
  verb: "동사",
  "i-adjective": "い형용사",
  "na-adjective": "な형용사",
  adverb: "부사",
  expression: "표현",
  particle: "조사",
  other: "기타",
};

const partOfSpeechBadgeStyles: Record<Exclude<PartOfSpeechFilter, "all">, { background: string; color: string }> = {
  noun: { background: "#eef2ff", color: "#3730a3" },
  verb: { background: "#ecfeff", color: "#155e75" },
  "i-adjective": { background: "#fef3c7", color: "#92400e" },
  "na-adjective": { background: "#fce7f3", color: "#9d174d" },
  adverb: { background: "#e0f2fe", color: "#075985" },
  expression: { background: "#dcfce7", color: "#166534" },
  particle: { background: "#f3e8ff", color: "#6b21a8" },
  other: { background: "#f3f4f6", color: "#374151" },
};

function normalizePartOfSpeech(partOfSpeech?: string): Exclude<PartOfSpeechFilter, "all"> {
  if (!partOfSpeech) return "other";
  const normalized = partOfSpeech.replace(/_/g, "-");
  if (normalized in partOfSpeechLabels) return normalized as Exclude<PartOfSpeechFilter, "all">;
  return "other";
}

const DEFAULT_SETTINGS: AppSettings = {
  ttsRate: 0.9,
  repeatCount: 1,
  repeatDelayMs: 500,
  showKoreanPronunciation: true,
  showReading: true,
};

function getWordKey(w: Pick<Word, "word" | "meaning" | "category">) {
  return `${w.word}|${w.meaning}|${w.category}`;
}

function getEffectiveLevel(word: Word): Exclude<LevelFilter, "all"> {
  return word.level ?? "beginner";
}
function getSentenceKeyword(word: Pick<Word, "word" | "sentenceKeyword">): string {
  return word.sentenceKeyword?.trim() || word.word;
}

function normalizeSavedWord(item: Partial<Word>): Word | null {
  if (!item.word || !item.meaning || !item.example || !item.category) return null;

  return {
    word: item.word,
    reading: item.reading,
    rubySegments: item.rubySegments,
    koreanPronunciation: item.koreanPronunciation,
    meaning: item.meaning,
    example: item.example,
    exampleReading: item.exampleReading,
    exampleRubySegments: item.exampleRubySegments,
    exampleKoreanPronunciation: item.exampleKoreanPronunciation,
    exampleMeaning: item.exampleMeaning,
    sentenceKeyword: item.sentenceKeyword,
    category: item.category as Word["category"],
  };
}

function saveWrongWord(w: Word, quizType: QuizType) {
  try {
    const raw = localStorage.getItem(WRONG_WORDS_KEY);
    const prev: WrongWord[] = raw ? JSON.parse(raw) : [];
    const currentWordKey = getWordKey(w);
    const alreadyExists = prev.some(
      (item) =>
        getWordKey(item) === currentWordKey &&
        item.quizType === quizType
    );
    if (alreadyExists) return;
    const next: WrongWord[] = [
      ...prev,
      {
        word: w.word,
        reading: w.reading,
        rubySegments: w.rubySegments,
        meaning: w.meaning,
        example: w.example,
        exampleReading: w.exampleReading,
        exampleRubySegments: w.exampleRubySegments,
        category: w.category,
        quizType,
        createdAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem(WRONG_WORDS_KEY, JSON.stringify(next));
  } catch {}
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getChoices(correct: Word, pool: Word[], quizType: QuizType): string[] {
  const others = pool.filter((w) => getWordKey(w) !== getWordKey(correct));
  const shuffled = shuffle(others).slice(0, 3);
  const all = shuffle([...shuffled, correct]);
  if (quizType === "jp-to-kr") return all.map((w) => w.meaning);
  return all.map((w) => w.word);
}

export default function WordsPage() {
  const router = useRouter();
  const [savedWords, setSavedWords] = useState<Word[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<PageMode>("study");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("전체");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [partOfSpeechFilter, setPartOfSpeechFilter] = useState<PartOfSpeechFilter>("all");

  // 퀴즈 상태
  const [quizType, setQuizType] = useState<QuizType>("jp-to-kr");
  const [showQuizKoreanPronunciation, setShowQuizKoreanPronunciation] = useState(
    DEFAULT_SETTINGS.showKoreanPronunciation
  );
  const [currentWord, setCurrentWord] = useState<Word | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [writingTargetKey, setWritingTargetKey] = useState<string | null>(null);
  const practicePadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(APP_SETTINGS_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as SettingsPayload;
      const sectionSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        ...(parsed.sections?.words ?? {}),
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
    setShowQuizKoreanPronunciation(settings.showKoreanPronunciation);
  }, [settings.showKoreanPronunciation]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<Word>[];
      if (!Array.isArray(parsed)) return;

      const next = parsed
        .map((item) => normalizeSavedWord(item))
        .filter((item): item is Word => item !== null);

      setSavedWords(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const isSaved = (w: Word) =>
    savedWords.some((s) => getWordKey(s) === getWordKey(w));

  const handleSaveToggle = (w: Word) => {
    const targetKey = getWordKey(w);
    const next = isSaved(w)
      ? savedWords.filter((saved) => getWordKey(saved) !== targetKey)
      : [...savedWords, w];

    setSavedWords(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const filteredWords =
    categoryFilter === "전체"
      ? WORDS
      : WORDS.filter((w) => w.category === categoryFilter);

  const filteredWordsByLevel =
    levelFilter === "all"
      ? filteredWords
      : filteredWords.filter((w) => getEffectiveLevel(w) === levelFilter);

  const filteredWordsByPartOfSpeech =
    partOfSpeechFilter === "all"
      ? filteredWordsByLevel
      : filteredWordsByLevel.filter((w) => normalizePartOfSpeech(w.partOfSpeech) === partOfSpeechFilter);

  const quizPool = filteredWordsByPartOfSpeech;

  const generateQuiz = useCallback(
    (pool: Word[]) => {
      if (pool.length < 4) return;
      const word = pool[Math.floor(Math.random() * pool.length)];
      const randomQuizType: QuizType = Math.random() < 0.5 ? "jp-to-kr" : "kr-to-jp";
      setQuizType(randomQuizType);
      setCurrentWord(word);
      setChoices(getChoices(word, pool, randomQuizType));
      setSelected(null);
    },
    []
  );

  useEffect(() => {
    if (mode === "quiz") {
      generateQuiz(quizPool);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, categoryFilter, levelFilter, partOfSpeechFilter]);

  const handleAnswer = (choice: string) => {
    if (selected !== null || !currentWord) return;
    setSelected(choice);
    const correctAnswer =
      quizType === "jp-to-kr"
        ? currentWord.meaning
        : currentWord.word;
    const isCorrect = choice === correctAnswer;
    if (!isCorrect) {
      saveWrongWord(currentWord, quizType);
    }
    setScore((s) => {
      const nextTotal = s.total + 1;
      if (nextTotal >= 5) {
        markTodayRoutineCompleted("words");
      }
      return {
        correct: s.correct + (isCorrect ? 1 : 0),
        total: nextTotal,
      };
    });
  };

  const handleNext = () => {
    generateQuiz(quizPool);
  };

  const correctAnswer = currentWord
    ? quizType === "jp-to-kr"
      ? currentWord.meaning
      : currentWord.word
    : "";

  const speakJapaneseText = useCallback(
    (text: string) => {
      void speakJapaneseWithPreferredTts(text, {
        rate: settings.ttsRate,
        pitch: 1,
        repeatCount: settings.repeatCount,
        repeatDelayMs: settings.repeatDelayMs,
      });
    },
    [settings.repeatCount, settings.repeatDelayMs, settings.ttsRate]
  );

  const handleWritingPracticeToggle = (word: Word) => {
    const targetKey = getWordKey(word);
    setWritingTargetKey((prev) => (prev === targetKey ? null : targetKey));
  };

  useEffect(() => {
    if (!writingTargetKey || mode !== "study") return;
    const frame = window.requestAnimationFrame(() => {
      practicePadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [mode, writingTargetKey]);

  const CATEGORIES: CategoryFilter[] = ["전체", "여행", "업무", "일상", "친구"];
  const LEVELS: Array<{ label: string; value: LevelFilter }> = [
    { label: "전체", value: "all" },
    { label: "기초", value: "beginner" },
    { label: "기본", value: "basic" },
    { label: "실전", value: "practical" },
  ];



  const PARTS_OF_SPEECH: Array<{ label: string; value: PartOfSpeechFilter }> = [
    { label: "전체 품사", value: "all" },
    { label: "명사", value: "noun" },
    { label: "동사", value: "verb" },
    { label: "い형용사", value: "i-adjective" },
    { label: "な형용사", value: "na-adjective" },
    { label: "부사", value: "adverb" },
    { label: "표현", value: "expression" },
    { label: "조사", value: "particle" },
    { label: "기타", value: "other" },
  ];


  return (
    <section className="mx-auto w-full max-w-6xl">
      <div className="page-header" style={{ marginBottom: "16px" }}>
        <h1 style={{ color: "#1e3a8a" }}>단어 학습</h1>
        <p className="muted" style={{ margin: 0, color: "#42526b" }}>
          자주 쓰는 일본어 단어를 듣고, 저장하고, 퀴즈로 익혀보세요.{" "}
          <span style={{ color: "#1d4ed8", fontWeight: 700 }}>저장 {savedWords.length}개</span>
        </p>
      </div>

      {/* 모드 전환 */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px", background: "#eff6ff", border: "1px solid #dbeafe", borderRadius: "14px", padding: "6px" }}>
        <button
          className="btn"
          onClick={() => setMode("study")}
          style={{
            flex: 1,
            background: mode === "study" ? "#2563eb" : "#ffffff",
            color: mode === "study" ? "#fff" : "#334155",
            border: mode === "study" ? "1px solid #2563eb" : "1px solid #bfdbfe",
            fontWeight: 600,
            borderRadius: "10px",
          }}
        >
          학습 모드
        </button>
        <button
          className="btn"
          onClick={() => {
            setMode("quiz");
            setScore({ correct: 0, total: 0 });
          }}
          style={{
            flex: 1,
            background: mode === "quiz" ? "#2563eb" : "#ffffff",
            color: mode === "quiz" ? "#fff" : "#334155",
            border: mode === "quiz" ? "1px solid #2563eb" : "1px solid #bfdbfe",
            fontWeight: 600,
            borderRadius: "10px",
          }}
        >
          퀴즈 모드
        </button>
      </div>

      <div className="card" style={{ marginBottom: "20px", padding: "14px", border: "1px solid #dbeafe", background: "#f8fbff" }}>
        <div className="label" style={{ color: "#1e3a8a", marginBottom: "8px", fontSize: "13px" }}>필터 선택</div>
      {/* 카테고리 필터 */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className="btn"
            onClick={() => {
              setCategoryFilter(cat);
              if (mode === "quiz") setScore({ correct: 0, total: 0 });
            }}
            style={{
              background: categoryFilter === cat ? "#2563eb" : "#fff",
              color: categoryFilter === cat ? "#fff" : "#475569",
              border: categoryFilter === cat ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
              fontSize: "13px",
              padding: "6px 14px",
              borderRadius: "999px",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* 난이도 필터 */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        {LEVELS.map((level) => (
          <button
            key={level.value}
            className="btn"
            onClick={() => {
              setLevelFilter(level.value);
              if (mode === "quiz") setScore({ correct: 0, total: 0 });
            }}
            style={{
              background: levelFilter === level.value ? "#0ea5e9" : "#fff",
              color: levelFilter === level.value ? "#fff" : "#475569",
              border: levelFilter === level.value ? "1px solid #0284c7" : "1px solid #cbd5e1",
              fontSize: "13px",
              padding: "6px 14px",
              borderRadius: "999px",
            }}
          >
            {level.label}
          </button>
        ))}
      </div>

      {/* 품사 필터 */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "0", flexWrap: "wrap" }}>
        {PARTS_OF_SPEECH.map((part) => (
          <button
            key={part.value}
            className="btn"
            onClick={() => {
              setPartOfSpeechFilter(part.value);
              if (mode === "quiz") setScore({ correct: 0, total: 0 });
            }}
            style={{
              background: partOfSpeechFilter === part.value ? "#f97316" : "#fff",
              color: partOfSpeechFilter === part.value ? "#fff" : "#475569",
              border: partOfSpeechFilter === part.value ? "1px solid #ea580c" : "1px solid #cbd5e1",
              fontSize: "13px",
              padding: "6px 14px",
              borderRadius: "999px",
            }}
          >
            {part.label}
          </button>
        ))}
      </div>
      </div>

      <div className="card" style={{ marginBottom: "20px", padding: "16px", border: "1px solid #dbeafe", background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)" }}>
        <div className="label" style={{ marginBottom: "10px", color: "#1e3a8a" }}>품사 빠른 설명</div>
        <div style={{ display: "grid", gap: "8px", fontSize: "13px", color: "#334155" }}>
          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "8px 10px" }}><strong>명사:</strong> 사람, 장소, 물건, 개념을 나타내는 말이에요. 예: 水, 駅, 会社</div>
          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "8px 10px" }}><strong>동사:</strong> 동작이나 상태를 나타내는 말이에요. 예: 食べる, 行く, 見る</div>
          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "8px 10px" }}><strong>い형용사:</strong> 끝이 い로 끝나며 상태나 성질을 나타내요. 예: 大きい, 小さい, 高い</div>
          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "8px 10px" }}><strong>な형용사:</strong> 명사를 꾸밀 때 な가 붙는 형용사예요. 예: 静か, 便利, きれい</div>
          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "8px 10px" }}><strong>조사:</strong> 단어 사이의 관계를 나타내는 짧은 말이에요. 예: は, を, に, で</div>
          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "8px 10px" }}><strong>표현:</strong> 인사나 자주 쓰는 고정 표현이에요. 예: こんにちは, ありがとう</div>
        </div>
      </div>

      {/* ===== 학습 모드 ===== */}
      {mode === "study" && (
        <div style={{
          marginTop: "24px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
          gap: "16px",
        }}>
          {filteredWordsByPartOfSpeech.length === 0 ? (
            <div className="card" style={{ textAlign: "center", color: "#888", padding: "24px 16px" }}>
              해당 조건의 단어가 없습니다.
            </div>
          ) : filteredWordsByPartOfSpeech.map((w) => {
            const saved = isSaved(w);
            return (
              <div key={getWordKey(w)} className="card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  padding: "16px",
                  border: saved ? "1px solid #93c5fd" : "1px solid #dbeafe",
                  borderRadius: "18px",
                  background: saved ? "linear-gradient(180deg,#ffffff 0%,#f0f9ff 100%)" : "#fff",
                  boxShadow: "0 6px 18px rgba(37, 99, 235, 0.08)",
                }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="card-top">
                    <div className="jp-text">{w.word}</div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <span className="badge" style={{ background: "#eff6ff", color: "#1e3a8a" }}>{w.category}</span>
                      <span className="badge" style={partOfSpeechBadgeStyles[normalizePartOfSpeech(w.partOfSpeech)]}>{partOfSpeechLabels[normalizePartOfSpeech(w.partOfSpeech)]}</span>
                      {saved && <span className="badge" style={{ background: "#fef3c7", color: "#9a3412" }}>저장됨</span>}
                    </div>
                  </div>
                  {settings.showReading && w.reading && (
                    <div style={{ marginTop: "4px", color: "#64748b", fontSize: "13px" }}>읽는 법: {w.reading}</div>
                  )}
                  {w.koreanPronunciation && (
                    settings.showKoreanPronunciation &&
                    <div style={{ marginTop: "4px" }}>
                      <div className="label">한글 발음</div>
                      <div style={{ color: "#666", fontSize: "14px" }}>{w.koreanPronunciation}</div>
                    </div>
                  )}
                  <div style={{ marginTop: "10px" }}>
                    <div className="label">뜻</div>
                    <div>{w.meaning}</div>
                  </div>
                  {w.example && (
                    <>
                      <div style={{ marginTop: "10px" }}>
                        <div className="label">예문</div>
                        <div style={{ color: "#555" }}>{w.example}</div>
                        {settings.showReading && w.exampleReading && (
                          <div style={{ marginTop: "4px", color: "#64748b", fontSize: "13px" }}>예문 읽는 법: {w.exampleReading}</div>
                        )}
                      </div>
                      {w.exampleMeaning && (
                        <div style={{ marginTop: "4px" }}>
                          <div className="label">예문 뜻</div>
                          <div style={{ color: "#666", fontSize: "13px" }}>{w.exampleMeaning}</div>
                        </div>
                      )}
                      {w.exampleKoreanPronunciation && (
                        settings.showKoreanPronunciation &&
                        <div style={{ marginTop: "4px" }}>
                          <div className="label">예문 한글 발음</div>
                          <div style={{ color: "#888", fontSize: "13px" }}>{w.exampleKoreanPronunciation}</div>
                        </div>
                      )}
                    </>
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
                    onClick={() => speakJapaneseText(w.reading?.trim() || w.word)}
                    className="btn"
                    style={{ borderRadius: "10px", border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", fontWeight: 600 }}
                  >
                    🔊 단어 듣기
                  </button>
                  <button
                    onClick={() => speakJapaneseText(w.exampleReading?.trim() || w.example)}
                    className="btn"
                    style={{ borderRadius: "10px", border: "1px solid #bae6fd", background: "#f0f9ff", color: "#0369a1", fontWeight: 600 }}
                  >
                    🔊 예문 듣기
                  </button>
                  <button
                    onClick={() => handleSaveToggle(w)}
                    className="btn"
                    style={{ borderRadius: "10px", border: saved ? "1px solid #fca5a5" : "1px solid #fdba74", background: saved ? "#fff1f2" : "#fff7ed", color: saved ? "#b91c1c" : "#c2410c", fontWeight: 600 }}
                  >
                    {saved ? "저장 취소" : "저장"}
                  </button>
                  <button
                    onClick={() => handleWritingPracticeToggle(w)}
                    className="btn"
                    style={{ borderRadius: "10px", border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", fontWeight: 600 }}
                  >
                    쓰기 연습
                  </button>
                  <button
                    onClick={() => router.push(`/language/sentences?word=${encodeURIComponent(getSentenceKeyword(w))}`)}
                    className="btn"
                    style={{ borderRadius: "10px", border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontWeight: 600 }}
                  >
                    관련 문장 보기
                  </button>
                </div>
                {mode === "study" && writingTargetKey === getWordKey(w) && (
                  <div ref={practicePadRef}>
                    <WritingPracticePad
                      title="단어 쓰기 연습"
                      targetText={w.word}
                      reading={settings.showReading ? w.reading : undefined}
                      meaning={w.meaning}
                      helperText="흐린 단어를 따라 써보세요. 마우스와 터치 모두 사용할 수 있어요."
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== 퀴즈 모드 ===== */}
      {mode === "quiz" && (
        <div>
          {quizPool.length < 4 ? (
            <div
              className="card"
              style={{ textAlign: "center", color: "#888", padding: "40px 20px" }}
            >
              퀴즈를 위해 해당 카테고리에 단어가 4개 이상 필요합니다.
            </div>
          ) : (
            <>
              {/* 점수 & 퀴즈 타입 */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <div style={{ fontSize: "14px", color: "#555" }}>
                  점수:{" "}
                  <strong style={{ color: "#222" }}>
                    {score.correct} / {score.total}
                  </strong>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    className="btn"
                    onClick={() => {
                      setShowQuizKoreanPronunciation((prev) => !prev);
                    }}
                    style={{
                      fontSize: "12px",
                      padding: "5px 10px",
                      background: "transparent",
                      color: "#222",
                      border: "1.5px solid #222",
                    }}
                  >
                    한글 발음 {showQuizKoreanPronunciation ? "숨김" : "표시"}
                  </button>
                </div>
              </div>

              {/* 문제 카드 */}
              {currentWord && (
                <div className="card" style={{ marginBottom: "20px" }}>
                  <div style={{ marginBottom: "8px" }}>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <span className="badge">{currentWord.category}</span>
                      <span className="badge" style={partOfSpeechBadgeStyles[normalizePartOfSpeech(currentWord.partOfSpeech)]}>{partOfSpeechLabels[normalizePartOfSpeech(currentWord.partOfSpeech)]}</span>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: "36px",
                      fontWeight: 700,
                      textAlign: "center",
                      padding: "24px 0 4px",
                      letterSpacing: "2px",
                    }}
                  >
                    {quizType === "kr-to-jp" ? currentWord.meaning : currentWord.word}
                  </div>
                  {quizType === "jp-to-kr" && currentWord.koreanPronunciation && (
                    showQuizKoreanPronunciation &&
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: "13px",
                        color: "#999",
                        marginBottom: "2px",
                      }}
                    >
                      {currentWord.koreanPronunciation}
                    </div>
                  )}
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: "13px",
                      color: "#aaa",
                      marginBottom: "8px",
                      marginTop: "4px",
                    }}
                  >
                    {quizType === "jp-to-kr"
                      ? "일본어에 맞는 뜻을 고르세요"
                      : "뜻에 맞는 일본어를 고르세요"}
                  </div>

                  {/* 보기 */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "10px",
                      marginTop: "16px",
                    }}
                  >
                    {choices.map((choice, idx) => {
                      const isCorrect = choice === correctAnswer;
                      const isSelected = choice === selected;
                      let bg = "transparent";
                      let color = "#222";
                      let border = "1.5px solid #ddd";

                      if (selected !== null) {
                        if (isCorrect) {
                          bg = "#e6f4ea";
                          color = "#1a7f37";
                          border = "1.5px solid #1a7f37";
                        } else if (isSelected) {
                          bg = "#fdecea";
                          color = "#c0392b";
                          border = "1.5px solid #c0392b";
                        }
                      }

                      return (
                        <button
                          key={`${choice}-${idx}`}
                          onClick={() => handleAnswer(choice)}
                          style={{
                            background: bg,
                            color,
                            border,
                            borderRadius: "10px",
                            padding: "14px 10px",
                            fontSize: "16px",
                            fontWeight: 600,
                            cursor: selected !== null ? "default" : "pointer",
                            transition: "all 0.15s",
                          }}
                        >
                          {quizType === "kr-to-jp" ? (
                            <>
                              <div>{choice}</div>
                              {(() => {
                                const choiceWord = quizPool.find((w) => w.word === choice);
                                return (
                                  <>
                                    {showQuizKoreanPronunciation && choiceWord?.koreanPronunciation && (
                                      <div style={{ fontSize: "12px", color: "#888", marginTop: "2px" }}>
                                        {choiceWord.koreanPronunciation}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </>
                          ) : (
                            choice
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* 피드백 */}
                  {selected !== null && (
                    <div
                      style={{
                        marginTop: "18px",
                        textAlign: "center",
                        fontWeight: 700,
                        fontSize: "18px",
                        color: selected === correctAnswer ? "#1a7f37" : "#c0392b",
                      }}
                    >
                      {selected === correctAnswer ? "정답! 🎉" : `오답 — 정답: ${correctAnswer}`}
                      <div style={{ marginTop: "6px", fontSize: "13px", color: "#555" }}>품사: [{partOfSpeechLabels[normalizePartOfSpeech(currentWord?.partOfSpeech)]}]</div>
                      {selected !== correctAnswer && currentWord && quizType === "kr-to-jp" && (
                        <div style={{ marginTop: "8px", fontSize: "14px", color: "#444" }}>
                          {currentWord.word}
                          {showQuizKoreanPronunciation && currentWord.koreanPronunciation && (
                            <div style={{ fontSize: "12px", color: "#888" }}>{currentWord.koreanPronunciation}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 다음 문제 버튼 */}
                  {selected !== null && (
                    <div style={{ marginTop: "16px", textAlign: "center" }}>
                      <button
                        className="btn"
                        onClick={handleNext}
                        style={{
                          background: "#222",
                          color: "#fff",
                          padding: "10px 32px",
                          fontWeight: 600,
                          fontSize: "15px",
                        }}
                      >
                        다음 문제
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

