"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GRAMMAR_LESSONS, GRAMMAR_PROGRESS_KEY, type GrammarProgressItem } from "@/data/grammar";
import type { RubySegment as WordRubySegment } from "@/data/words";
import type { RubySegment as SentenceRubySegment } from "@/data/sentences";
import { markTodayRoutineCompleted } from "@/utils/dailyRoutineProgress";
import { CURRICULUM_REVIEW_KEY, type CurriculumReviewItem } from "@/utils/curriculumProgress";

type Word = {
  word: string;
  meaning: string;
  example: string;
  category: "일상" | "여행" | "업무" | "친구";
  partOfSpeech?: string;
  sentenceKeyword?: string;
  reading?: string;
  rubySegments?: WordRubySegment[];
  exampleReading?: string;
  exampleRubySegments?: WordRubySegment[];
};

type Sentence = {
  japanese: string;
  meaning: string;
  category: "일상" | "여행" | "업무" | "친구";
  note: string;
  pattern?: string;
  reading?: string;
  rubySegments?: SentenceRubySegment[];
};

type ReviewTab = "all" | "course" | "words" | "sentences" | "grammar" | "kana";
type WrongItem = string | Record<string, unknown>;

const partOfSpeechLabels: Record<string, string> = {
  noun: "명사",
  verb: "동사",
  "i-adjective": "い형용사",
  "na-adjective": "な형용사",
  adverb: "부사",
  expression: "표현",
  particle: "조사",
  other: "기타",
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

const WORDS_KEY = "savedWords";
const SENTENCES_KEY = "savedSentences";
const WRONG_KANA_KEY = "wrongKana";
const WRONG_KANA_CHARS_KEY = "wrongKanaChars";
const WRONG_WORDS_KEY = "wrongWords";
const WRONG_SENTENCES_KEY = "wrongSentences";
const REVIEW_COMPLETED_ITEMS_KEY = "reviewCompletedItemsByDate";
const EMPTY_REVIEW_MESSAGE = "아직 복습할 항목이 없어요. 단어와 문장을 저장하거나 퀴즈를 풀면 복습에 모여요.";

type ReviewCompletedItemsEntry = {
  date: string;
  items: string[];
};

function readReviewedItemsByDate(): ReviewCompletedItemsEntry[] {
  try {
    const raw = localStorage.getItem(REVIEW_COMPLETED_ITEMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry): entry is { date?: unknown; items?: unknown } => !!entry && typeof entry === "object")
      .map((entry) => ({
        date: typeof entry.date === "string" ? entry.date : "",
        items: Array.isArray(entry.items)
          ? entry.items.filter((item): item is string => typeof item === "string")
          : [],
      }))
      .filter((entry) => entry.date.length > 0);
  } catch {
    return [];
  }
}

function writeReviewedItemsByDate(entries: ReviewCompletedItemsEntry[]): void {
  localStorage.setItem(REVIEW_COMPLETED_ITEMS_KEY, JSON.stringify(entries));
}

function getReviewedItemsForDate(date: string): string[] {
  const todayEntry = readReviewedItemsByDate().find((entry) => entry.date === date);
  if (!todayEntry) return [];
  return Array.from(new Set(todayEntry.items));
}

function saveReviewedItemsForDate(date: string, itemIds: string[]): void {
  const uniqueItems = Array.from(new Set(itemIds));
  const completedByDate = readReviewedItemsByDate().filter((entry) => entry.date !== date);
  writeReviewedItemsByDate([...completedByDate, { date, items: uniqueItems }]);
}

function getTodayLocalDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizePartOfSpeech(partOfSpeech?: string): string {
  if (!partOfSpeech) return "other";
  return partOfSpeech.replace(/_/g, "-");
}

function loadArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function WrongItemText({ item }: { item: WrongItem }) {
  if (typeof item === "string") return <>{item}</>;
  const word = typeof item.word === "string" ? item.word : "";
  const jp = typeof item.japanese === "string" ? item.japanese : "";
  const example = typeof item.example === "string" ? item.example : "";
  const koreanPronunciation = typeof item.koreanPronunciation === "string" ? item.koreanPronunciation : undefined;
  const exampleKoreanPronunciation = typeof item.exampleKoreanPronunciation === "string" ? item.exampleKoreanPronunciation : undefined;
  const meaning = typeof item.meaning === "string" ? item.meaning : "";
  const main = word || jp || "복습 항목";
  return (
    <>
      <div>{main}</div>
      {koreanPronunciation && <div style={{ marginTop: "2px", color: "#7b867b", fontSize: "13px" }}>한글 발음: {koreanPronunciation}</div>}
      {meaning ? ` (${meaning})` : ""}
      {example && (
        <div style={{ marginTop: "6px", color: "#555" }}>
          <div>{example}</div>
          {exampleKoreanPronunciation && <div style={{ marginTop: "2px", color: "#7b867b", fontSize: "13px" }}>예문 한글 발음: {exampleKoreanPronunciation}</div>}
        </div>
      )}
    </>
  );
}

function buildWrongItemId(prefix: string, item: WrongItem): string {
  if (typeof item === "string") return `${prefix}:${item}`;
  const word = typeof item.word === "string" ? item.word : "";
  const japanese = typeof item.japanese === "string" ? item.japanese : "";
  const meaning = typeof item.meaning === "string" ? item.meaning : "";
  const char = typeof item.char === "string" ? item.char : "";
  const answer = typeof item.answer === "string" ? item.answer : "";
  const question = typeof item.question === "string" ? item.question : "";
  const fallback = JSON.stringify(item);
  return `${prefix}:${word}|${japanese}|${meaning}|${char}|${answer}|${question}|${fallback}`;
}

function getKanaTypeLabel(type?: string): string {
  if (!type) return "종류 미확인";
  if (type === "hiragana") return "히라가나";
  if (type === "katakana") return "가타카나";
  return type;
}

function getKanaModeLabel(mode?: string): string {
  if (!mode) return "복습 항목";
  if (mode === "quiz") return "퀴즈 오답";
  if (mode === "confusing") return "헷갈리는 글자";
  if (mode === "writing") return "쓰기 연습";
  return mode;
}

function parseKanaReviewItem(item: WrongItem): {
  char: string;
  romaji: string;
  typeLabel: string;
  modeLabel: string;
} {
  if (typeof item === "string") {
    return {
      char: item,
      romaji: "",
      typeLabel: "종류 미확인",
      modeLabel: "복습 항목",
    };
  }

  const charCandidates = [item.char, item.kana, item.text, item.question, item.answer];
  const char = charCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? "";
  const romaji = typeof item.romaji === "string" ? item.romaji : "";
  const type = typeof item.type === "string" ? item.type : "";
  const mode = typeof item.mode === "string" ? item.mode : "";

  return {
    char,
    romaji,
    typeLabel: getKanaTypeLabel(type),
    modeLabel: getKanaModeLabel(mode),
  };
}

export default function ReviewPage() {
  const [activeReviewTab, setActiveReviewTab] = useState<ReviewTab>("all");
  const [savedWords, setSavedWords] = useState<Word[]>([]);
  const [savedSentences, setSavedSentences] = useState<Sentence[]>([]);
  const [grammarReviewItems, setGrammarReviewItems] = useState<GrammarProgressItem[]>([]);
  const [wrongKana, setWrongKana] = useState<WrongItem[]>([]);
  const [wrongKanaChars, setWrongKanaChars] = useState<string[]>([]);
  const [wrongWords, setWrongWords] = useState<WrongItem[]>([]);
  const [wrongSentences, setWrongSentences] = useState<WrongItem[]>([]);
  const [reviewedItemIds, setReviewedItemIds] = useState<string[]>([]);
  const [curriculumReviewItems, setCurriculumReviewItems] = useState<CurriculumReviewItem[]>([]);
  const [reviewOpenedAt] = useState(() => Date.now());
  const hasMarkedReviewCompletedRef = useRef(false);

  useEffect(() => {
    const words = loadArray<Word>(WORDS_KEY);
    const sentences = loadArray<Sentence>(SENTENCES_KEY);
    const grammar = loadArray<GrammarProgressItem>(GRAMMAR_PROGRESS_KEY).filter(
      (item) => item && (item.wrongCount > 0 || item.lastResult === "wrong"),
    );
    const kana = loadArray<WrongItem>(WRONG_KANA_KEY);
    const charsRaw = loadArray<unknown>(WRONG_KANA_CHARS_KEY);
    const chars = charsRaw.filter((item): item is string => typeof item === "string");
    const wWords = loadArray<WrongItem>(WRONG_WORDS_KEY);
    const wSentences = loadArray<WrongItem>(WRONG_SENTENCES_KEY);

    setSavedWords(words);
    setSavedSentences(sentences);
    setGrammarReviewItems(grammar);
    setWrongKana(kana);
    setWrongKanaChars(chars);
    setWrongWords(wWords);
    setWrongSentences(wSentences);
    setCurriculumReviewItems(loadArray<CurriculumReviewItem>(CURRICULUM_REVIEW_KEY));

    const dateKey = getTodayLocalDateKey();
    const todayItems = getReviewedItemsForDate(dateKey);

    setReviewedItemIds(todayItems);
    if (todayItems.length >= 3) {
      markTodayRoutineCompleted("review");
      hasMarkedReviewCompletedRef.current = true;
    }
  }, []);


  const kanaReviewCount = useMemo(() => {
    const charsFromWrongKana = wrongKana
      .map((item) => (typeof item === "string" ? item : typeof item.char === "string" ? item.char : ""))
      .filter(Boolean);
    return new Set([...charsFromWrongKana, ...wrongKanaChars]).size;
  }, [wrongKana, wrongKanaChars]);

  const handleDeleteWord = (w: Word) => {
    const next = savedWords.filter((x) => x.word !== w.word);
    setSavedWords(next);
    localStorage.setItem(WORDS_KEY, JSON.stringify(next));
  };

  const handleDeleteSentence = (s: Sentence) => {
    const next = savedSentences.filter((x) => x.japanese !== s.japanese);
    setSavedSentences(next);
    localStorage.setItem(SENTENCES_KEY, JSON.stringify(next));
  };

  const handleDeleteWrongWord = (targetIndex: number) => {
    const next = wrongWords.filter((_, index) => index !== targetIndex);
    setWrongWords(next);
    localStorage.setItem(WRONG_WORDS_KEY, JSON.stringify(next));
  };

  const handleDeleteWrongSentence = (targetIndex: number) => {
    const next = wrongSentences.filter((_, index) => index !== targetIndex);
    setWrongSentences(next);
    localStorage.setItem(WRONG_SENTENCES_KEY, JSON.stringify(next));
  };

  const handleDeleteGrammarReviewItem = (lessonId: string) => {
    const next = grammarReviewItems.filter((item) => item.lessonId !== lessonId);
    setGrammarReviewItems(next);

    const grammarProgress = loadArray<GrammarProgressItem>(GRAMMAR_PROGRESS_KEY);
    const nextProgress = grammarProgress.filter((item) => item.lessonId !== lessonId);
    localStorage.setItem(GRAMMAR_PROGRESS_KEY, JSON.stringify(nextProgress));
  };

  const handleDeleteWrongKana = (targetIndex: number) => {
    const targetItem = wrongKana[targetIndex];
    const targetChar =
      typeof targetItem === "string" ? targetItem : typeof targetItem?.char === "string" ? targetItem.char : "";
    const nextWrongKana = wrongKana.filter((_, index) => index !== targetIndex);
    setWrongKana(nextWrongKana);
    localStorage.setItem(WRONG_KANA_KEY, JSON.stringify(nextWrongKana));

    if (targetChar) {
      const hasSameCharInWrongKana = nextWrongKana.some((item) =>
        (typeof item === "string" ? item : typeof item.char === "string" ? item.char : "") === targetChar,
      );
      if (!hasSameCharInWrongKana) {
        const nextWrongKanaChars = wrongKanaChars.filter((char) => char !== targetChar);
        setWrongKanaChars(nextWrongKanaChars);
        localStorage.setItem(WRONG_KANA_CHARS_KEY, JSON.stringify(nextWrongKanaChars));
      }
    }
  };

  const handleDeleteWrongKanaChar = (targetIndex: number) => {
    const next = wrongKanaChars.filter((_, index) => index !== targetIndex);
    setWrongKanaChars(next);
    localStorage.setItem(WRONG_KANA_CHARS_KEY, JSON.stringify(next));
  };

  const handleDeleteCurriculumReview = (id: string) => {
    const next = curriculumReviewItems.filter((item) => item.id !== id);
    setCurriculumReviewItems(next);
    localStorage.setItem(CURRICULUM_REVIEW_KEY, JSON.stringify(next));
  };

  const scheduleCurriculumReview = (id: string, correct: boolean) => {
    const now = new Date();
    const next = curriculumReviewItems.map((item) => {
      if (item.id !== id) return item;
      const currentInterval = item.intervalDays ?? 1;
      const intervalDays = correct ? ([1, 3, 7, 14, 30].find((days) => days > currentInterval) ?? 30) : 1;
      return {
        ...item,
        wrongCount: correct ? item.wrongCount : (item.wrongCount ?? 0) + 1,
        lastWrongAt: correct ? item.lastWrongAt : now.toISOString(),
        intervalDays,
        nextReviewAt: new Date(now.getTime() + intervalDays * 86_400_000).toISOString(),
      };
    });
    setCurriculumReviewItems(next);
    localStorage.setItem(CURRICULUM_REVIEW_KEY, JSON.stringify(next));
    trackReviewAction(`course:${id}`);
  };

  const trackReviewAction = (itemId: string) => {
    const dateKey = getTodayLocalDateKey();

    setReviewedItemIds((prev) => {
      if (prev.includes(itemId)) return prev;

      const next = [...prev, itemId];
      saveReviewedItemsForDate(dateKey, next);

      if (next.length >= 3 && !hasMarkedReviewCompletedRef.current) {
        markTodayRoutineCompleted("review");
        hasMarkedReviewCompletedRef.current = true;
      }

      return next;
    });
  };

  const isReviewed = (itemId: string) => reviewedItemIds.includes(itemId);
  const reviewActionButtonStyle = (done: boolean) => ({
    borderColor: done ? "#22c55e" : "#2563eb",
    background: done ? "#22c55e" : "#2563eb",
    color: "#fff",
    boxShadow: done ? "0 6px 14px rgba(34, 197, 94, 0.24)" : "0 8px 18px rgba(37, 99, 235, 0.22)",
  });

  const showWords = activeReviewTab === "all" || activeReviewTab === "words";
  const showCourse = activeReviewTab === "all" || activeReviewTab === "course";
  const showSentences = activeReviewTab === "all" || activeReviewTab === "sentences";
  const showGrammar = activeReviewTab === "all" || activeReviewTab === "grammar";
  const showKana = activeReviewTab === "all" || activeReviewTab === "kana";
  const dueCurriculumReviewItems = curriculumReviewItems.filter((item) => !item.nextReviewAt || new Date(item.nextReviewAt).getTime() <= reviewOpenedAt);


  return (
    <section>
      <div className="page-header card" style={{ marginBottom: "14px", padding: "18px", border: "1px solid #dbeafe", background: "linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%)", boxShadow: "0 10px 22px rgba(37,99,235,0.08)" }}>
        <h1 style={{ color: "#1e3a8a", marginBottom: "4px" }}>복습</h1>
        <p className="muted" style={{ margin: 0, color: "#334155" }}>저장한 단어와 틀린 문제를 다시 확인해 보세요.</p>
        <p className="muted" style={{ margin: "8px 0 0", color: "#64748b", fontSize: "13px" }}>오늘 완료한 복습 항목은 오늘만 [복습 완료됨]으로 표시돼요. 내일은 다시 복습할 수 있어요.</p>
      </div>

      <div className="card" style={{ marginBottom: "14px", padding: "14px", borderColor: "#dbeafe", boxShadow: "0 6px 16px rgba(15,23,42,.06)" }}>
        <div className="label" style={{ marginBottom: "10px", color: "#1d4ed8" }}>복습 요약</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "10px" }}>
          {[
            { label: "저장 단어", count: savedWords.length },
            { label: "저장 문장", count: savedSentences.length },
            { label: "문법 복습", count: grammarReviewItems.length },
            { label: "가나 복습", count: kanaReviewCount },
            { label: "오늘 과정 복습", count: dueCurriculumReviewItems.length },
          ].map((summary) => (
            <div key={summary.label} style={{ borderRadius: "14px", border: "1px solid #dbeafe", background: "#f8fbff", padding: "10px 12px" }}>
              <div style={{ fontSize: "12px", color: "#475569" }}>{summary.label}</div>
              <div style={{ marginTop: "2px", fontWeight: 700, color: "#1d4ed8" }}>{summary.count}개</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px", padding: "4px", borderRadius: "14px", background: "#f1f5ff", border: "1px solid #dbeafe" }}>
        {[
          { key: "all", label: "전체" },
          { key: "course", label: "새 과정" },
          { key: "words", label: "단어" },
          { key: "sentences", label: "문장" },
          { key: "grammar", label: "문법" },
          { key: "kana", label: "가나" },
        ].map((tab) => {
          const selected = activeReviewTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveReviewTab(tab.key as ReviewTab)}
              className="btn"
              style={{
                borderRadius: "999px",
                borderColor: selected ? "#2563eb" : "transparent",
                background: selected ? "#2563eb" : "transparent",
                color: selected ? "#fff" : "#334155",
                boxShadow: selected ? "0 8px 16px rgba(37,99,235,0.24)" : "none",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {showCourse && (
        <>
          <div className="section-title"><h2>오늘 복습할 과정 문제</h2><span className="count">{dueCurriculumReviewItems.length}개</span></div>
          {dueCurriculumReviewItems.length === 0 ? <div className="empty-state">오늘 예정된 과정 복습을 모두 마쳤어요. 전체 보관 항목은 {curriculumReviewItems.length}개예요. <Link href="/language/learn">[배우기]</Link>에서 다음 수업을 시작해 보세요.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px" }}>
              {dueCurriculumReviewItems.map((item) => <li key={item.id} className="card" style={{ marginBottom: 10, border: "1px solid #cfe6d9", borderRadius: 16 }}><div className="label" style={{ color: "#287a59" }}>{item.lessonTitle} · 누적 오답 {item.wrongCount ?? 1}회</div><h3 style={{ margin: "5px 0", fontSize: 16 }}>{item.prompt}</h3><p className="muted" style={{ margin: "0 0 10px" }}>{item.explanation}</p><div className="card-actions" style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}><Link href={`/language/learn?lesson=${item.lessonId}`} className="btn">수업 다시 보기</Link><button type="button" onClick={() => scheduleCurriculumReview(item.id, false)} className="btn">아직 어려워요</button><button type="button" onClick={() => scheduleCurriculumReview(item.id, true)} className="btn" style={reviewActionButtonStyle(false)}>기억했어요</button><button type="button" onClick={() => handleDeleteCurriculumReview(item.id)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button></div></li>)}
            </ul>
          )}
        </>
      )}

      {showWords && (
        <>
          <div className="section-title"><h2>저장한 단어</h2><span className="count">{savedWords.length}개</span></div>
          {savedWords.length === 0 ? <div className="empty-state">{EMPTY_REVIEW_MESSAGE} <Link href="/language/words">[단어]</Link>에서 단어를 저장해 보세요.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {savedWords.map((w) => (
                <li key={w.word} className="card" style={{ marginBottom: "14px", overflowWrap: "anywhere", wordBreak: "break-word", border: "1px solid #dbeafe", borderRadius: "16px", boxShadow: "0 8px 20px rgba(15,23,42,.06)" }}>
                  <div className="card-top"><div className="jp-text">{w.word}</div><div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}><span className="badge">{w.category}</span>{partOfSpeechLabels[normalizePartOfSpeech(w.partOfSpeech)] && <span className="badge">{partOfSpeechLabels[normalizePartOfSpeech(w.partOfSpeech)]}</span>}</div></div>
                  <div style={{ marginTop: "12px" }}><div className="label">뜻</div><div>{w.meaning}</div></div>
                  <div style={{ marginTop: "10px" }}><div className="label">예문</div><div style={{ color: "#555" }}>{w.example}</div></div>
                  <div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Link href="/language/words" className="btn">단어 다시 학습</Link>
                    <Link href={`/language/sentences?word=${encodeURIComponent(w.sentenceKeyword || w.word)}`} className="btn">관련 문장 보기</Link>
                    <button
                      type="button"
                      onClick={() => trackReviewAction(`saved-word:${w.word}`)}
                      className="btn"
                      style={reviewActionButtonStyle(isReviewed(`saved-word:${w.word}`))}
                    >
                      {isReviewed(`saved-word:${w.word}`) ? "복습 완료됨" : "복습 완료"}
                    </button>
                    <button onClick={(event) => { event.stopPropagation(); handleDeleteWord(w); }} className="btn btn-danger">삭제</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="section-title"><h2>틀린 단어</h2><span className="count">{wrongWords.length}개</span></div>
          {wrongWords.length === 0 ? <div className="empty-state">틀린 단어가 없습니다.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {wrongWords.map((item, idx) => { const itemId = buildWrongItemId("wrong-word", item); return <li key={`ww-${idx}`} className="card" style={{ marginBottom: "10px", overflowWrap: "anywhere", border: "1px solid #dbeafe" }}><div style={{ marginBottom: "8px" }}><WrongItemText item={item} /></div><div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}><Link href="/language/words" className="btn">단어 다시 학습</Link><button type="button" onClick={() => trackReviewAction(itemId)} className="btn" style={reviewActionButtonStyle(isReviewed(itemId))}>{isReviewed(itemId) ? "복습 완료됨" : "복습 완료"}</button><button type="button" onClick={() => handleDeleteWrongWord(idx)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button></div></li>; })}
            </ul>
          )}
        </>
      )}

      {showSentences && (
        <>
          <div className="section-title"><h2>저장한 문장</h2><span className="count">{savedSentences.length}개</span></div>
          {savedSentences.length === 0 ? <div className="empty-state">{EMPTY_REVIEW_MESSAGE} <Link href="/language/sentences">[문장]</Link>에서 문장을 저장해 보세요.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {savedSentences.map((s) => (
                <li key={s.japanese} className="card" style={{ marginBottom: "14px", overflowWrap: "anywhere", wordBreak: "break-word", border: "1px solid #dbeafe", borderRadius: "16px", boxShadow: "0 8px 20px rgba(15,23,42,.06)" }}>
                  <div className="card-top"><div className="jp-text">{s.japanese}</div><div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}><span className="badge">{s.category}</span>{s.pattern && <span className="badge">{sentencePatternLabels[s.pattern] ?? "기타"}</span>}</div></div>
                  <div style={{ marginTop: "12px" }}><div className="label">뜻</div><div>{s.meaning}</div></div>
                  <div style={{ marginTop: "10px" }}><div className="label">설명</div><div style={{ color: "#555" }}>{s.note}</div></div>
                  <div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Link href="/language/sentences" className="btn">문장 다시 학습</Link>
                    <button
                      type="button"
                      onClick={() => trackReviewAction(`saved-sentence:${s.japanese}`)}
                      className="btn"
                      style={reviewActionButtonStyle(isReviewed(`saved-sentence:${s.japanese}`))}
                    >
                      {isReviewed(`saved-sentence:${s.japanese}`) ? "복습 완료됨" : "복습 완료"}
                    </button>
                    <button onClick={(event) => { event.stopPropagation(); handleDeleteSentence(s); }} className="btn btn-danger">삭제</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="section-title"><h2>틀린 문장</h2><span className="count">{wrongSentences.length}개</span></div>
          {wrongSentences.length === 0 ? <div className="empty-state">틀린 문장이 없습니다.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {wrongSentences.map((item, idx) => { const itemId = buildWrongItemId("wrong-sentence", item); return <li key={`ws-${idx}`} className="card" style={{ marginBottom: "10px", overflowWrap: "anywhere", border: "1px solid #dbeafe" }}><div style={{ marginBottom: "8px" }}><WrongItemText item={item} /></div><div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}><Link href="/language/sentences" className="btn">문장 다시 학습</Link><button type="button" onClick={() => trackReviewAction(itemId)} className="btn" style={reviewActionButtonStyle(isReviewed(itemId))}>{isReviewed(itemId) ? "복습 완료됨" : "복습 완료"}</button><button type="button" onClick={() => handleDeleteWrongSentence(idx)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button></div></li>; })}
            </ul>
          )}
        </>
      )}

      {showGrammar && (
        <>
          <div className="section-title"><h2>문법 복습</h2><span className="count">{grammarReviewItems.length}개</span></div>
          {grammarReviewItems.length === 0 ? <div className="empty-state">{EMPTY_REVIEW_MESSAGE} <Link href="/language/grammar">[문법]</Link>에서 연습 문제를 풀어 보세요.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {grammarReviewItems.map((item) => (
                <li key={item.lessonId} className="card" style={{ marginBottom: "14px", overflowWrap: "anywhere", border: "1px solid #dbeafe", borderRadius: "16px", boxShadow: "0 8px 20px rgba(15,23,42,.06)" }}>
                  {(() => {
                    const lesson = GRAMMAR_LESSONS.find((entry) => entry.id === item.lessonId);
                    return (
                      <>
                  <div className="card-top"><div className="jp-text">{item.title}</div><div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}><span className="badge">{item.category}</span><span className="badge">{item.pattern}</span></div></div>
                  <div style={{ marginTop: "10px", fontSize: "14px" }}>오답 {item.wrongCount}회 · 최근 결과: {item.lastResult === "correct" ? "정답" : "오답"}</div>
                  <div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}><button type="button" onClick={() => trackReviewAction(`grammar:${item.lessonId}`)} className="btn" style={reviewActionButtonStyle(isReviewed(`grammar:${item.lessonId}`))}>{isReviewed(`grammar:${item.lessonId}`) ? "복습 완료됨" : "복습 완료"}</button><Link href={`/language/grammar?lesson=${item.lessonId}`} className="btn">문법 다시 학습</Link><button type="button" onClick={() => handleDeleteGrammarReviewItem(item.lessonId)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button></div>
                      </>
                    );
                  })()}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {showKana && (
        <>
          <div className="section-title"><h2>가나 복습</h2><span className="count">{wrongKana.length}개</span></div>
          {wrongKana.length === 0 ? <div className="empty-state">{EMPTY_REVIEW_MESSAGE} <Link href="/language/kana">[가나]</Link>에서 퀴즈를 풀어 보세요.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {wrongKana.map((item, idx) => {
                const itemId = buildWrongItemId("wrong-kana", item);
                const parsed = parseKanaReviewItem(item);
                return (
                  <li key={`wk-${idx}`} className="card" style={{ marginBottom: "10px", overflowWrap: "anywhere", border: "1px solid #dbeafe" }}>
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontSize: "30px", fontWeight: 700, lineHeight: 1.2, color: "#0f172a" }}>{parsed.char || "가나 정보 없음"}</div>
                      <div style={{ marginTop: "4px", color: "#475569", fontSize: "14px" }}>
                        {parsed.typeLabel}{parsed.romaji ? ` · ${parsed.romaji}` : ""}
                      </div>
                      <div style={{ marginTop: "6px", color: "#334155", fontSize: "13px" }}>복습 사유: {parsed.modeLabel}</div>
                    </div>
                    <div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <Link href="/language/kana" className="btn">가나 다시 학습</Link>
                      <button type="button" onClick={() => trackReviewAction(itemId)} className="btn" style={reviewActionButtonStyle(isReviewed(itemId))}>{isReviewed(itemId) ? "복습 완료됨" : "복습 완료"}</button>
                      <button type="button" onClick={() => handleDeleteWrongKana(idx)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="section-title"><h2>헷갈린 글자</h2><span className="count">{wrongKanaChars.length}개</span></div>
          {wrongKanaChars.length === 0 ? <div className="empty-state">헷갈린 글자가 없습니다.</div> : (
            <div className="card" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px", border: "1px solid #dbeafe" }}>{wrongKanaChars.map((char, idx) => { const itemId = `kana-char:${char}`; return <div key={`kc-${char}-${idx}`} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", borderRadius: "999px", background: "#f8fbff" }}><span className="badge" style={{ fontSize: "18px" }}>{char}</span><button type="button" onClick={() => trackReviewAction(itemId)} className="btn" style={reviewActionButtonStyle(isReviewed(itemId))}>{isReviewed(itemId) ? "복습 완료됨" : "복습 완료"}</button><button type="button" onClick={() => handleDeleteWrongKanaChar(idx)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button></div>; })}</div>
          )}

          <div className="card-actions" style={{ justifyContent: "flex-end", marginBottom: "18px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Link href="/language/kana" className="btn">가나 다시 학습</Link>
          </div>
        </>
      )}

    </section>
  );
}
