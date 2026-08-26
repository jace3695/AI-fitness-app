"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";

import { WORDS } from "@/data/words";
import { SENTENCES } from "@/data/sentences";
import { GRAMMAR_LESSONS, GRAMMAR_PROGRESS_KEY, type GrammarProgressItem } from "@/data/grammar";
import { CURRICULUM, TRACKS, type CourseTrack } from "@/data/curriculum";
import { CURRICULUM_REVIEW_KEY, loadCurriculumProgress, type CurriculumProgress } from "@/utils/curriculumProgress";
import { getLocalDateKey } from "@/utils/dateKey";

function getCurrentStreak(activityDates: string[]): number {
  const dates = new Set(activityDates);
  const cursor = new Date();
  const today = getLocalDateKey(cursor);
  if (!dates.has(today)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dates.has(getLocalDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

type SectionKey = "wrongKana" | "wrongWords" | "wrongSentences";
type ProgressTab = "all" | "kana" | "words" | "sentences" | "grammar";

const SECTIONS: { key: SectionKey; label: string; href: string; linkLabel: string }[] = [
  { key: "wrongKana", label: "헷갈린 글자", href: "/language/kana", linkLabel: "가나 다시 학습" },
  { key: "wrongWords", label: "틀린 단어", href: "/language/words", linkLabel: "단어 다시 학습" },
  { key: "wrongSentences", label: "틀린 문장", href: "/language/sentences", linkLabel: "문장 다시 학습" },
];

type AnyItem = string | Record<string, any>;

interface KanaQuizItem {
  char: string;
  romaji: string;
  type?: string;
  mode?: string;
  createdAt?: string;
}

interface KanaSummaryCard {
  key: "basic" | "dakuon" | "youon" | "special";
  label: string;
  total: number;
  wrongCount: number;
  confusingCount: number;
  statusText: "오답 없음" | "복습 권장" | "집중 복습 필요";
  statusColor: string;
  bgColor: string;
}

interface KanaTopWrongItem {
  char: string;
  romaji: string;
  count: number;
  lastWrongAt?: string;
}

interface WordQuizItem {
  word: string;
  meaning: string;
  category?: string;
  quizType?: string;
  createdAt?: string;
  mode: "wordToMeaning" | "meaningToWord";
}

interface SentenceQuizItem {
  japanese: string;
  meaning: string;
  category?: string;
  quizType?: string;
  createdAt?: string;
  mode: "japaneseToMeaning" | "meaningToJapanese";
}

const ROMAJI_POOL = [
  "a","i","u","e","o",
  "ka","ki","ku","ke","ko",
  "sa","shi","su","se","so",
  "ta","chi","tsu","te","to",
  "na","ni","nu","ne","no",
  "ha","hi","fu","he","ho",
  "ma","mi","mu","me","mo",
  "ya","yu","yo",
  "ra","ri","ru","re","ro",
  "wa","wi","we","wo","n",
  "ga","gi","gu","ge","go",
  "za","ji","zu","ze","zo",
  "da","de","do",
  "ba","bi","bu","be","bo",
  "pa","pi","pu","pe","po",
  "kya","kyu","kyo",
  "sha","shu","sho",
  "cha","chu","cho",
  "nya","nyu","nyo",
  "hya","hyu","hyo",
  "mya","myu","myo",
  "rya","ryu","ryo",
  "gya","gyu","gyo",
  "ja","ju","jo",
  "bya","byu","byo",
  "pya","pyu","pyo",
];

const BASIC_KANA_CHARS = new Set([
  "あ","い","う","え","お","か","き","く","け","こ","さ","し","す","せ","そ","た","ち","つ","て","と","な","に","ぬ","ね","の","は","ひ","ふ","へ","ほ","ま","み","む","め","も","や","ゆ","よ","ら","り","る","れ","ろ","わ","を","ん",
  "ア","イ","ウ","エ","オ","カ","キ","ク","ケ","コ","サ","シ","ス","セ","ソ","タ","チ","ツ","テ","ト","ナ","ニ","ヌ","ネ","ノ","ハ","ヒ","フ","ヘ","ホ","マ","ミ","ム","メ","モ","ヤ","ユ","ヨ","ラ","リ","ル","レ","ロ","ワ","ヲ","ン",
]);
const DAKUON_KANA_CHARS = new Set([
  "が","ぎ","ぐ","げ","ご","ざ","じ","ず","ぜ","ぞ","だ","ぢ","づ","で","ど","ば","び","ぶ","べ","ぼ","ぱ","ぴ","ぷ","ぺ","ぽ",
  "ガ","ギ","グ","ゲ","ゴ","ザ","ジ","ズ","ゼ","ゾ","ダ","ヂ","ヅ","デ","ド","バ","ビ","ブ","ベ","ボ","パ","ピ","プ","ペ","ポ",
]);
const YOON_KANA_CHARS = new Set([
  "きゃ","きゅ","きょ","しゃ","しゅ","しょ","ちゃ","ちゅ","ちょ","にゃ","にゅ","にょ","ひゃ","ひゅ","ひょ","みゃ","みゅ","みょ","りゃ","りゅ","りょ","ぎゃ","ぎゅ","ぎょ","じゃ","じゅ","じょ","びゃ","びゅ","びょ","ぴゃ","ぴゅ","ぴょ",
  "キャ","キュ","キョ","シャ","シュ","ショ","チャ","チュ","チョ","ニャ","ニュ","ニョ","ヒャ","ヒュ","ヒョ","ミャ","ミュ","ミョ","リャ","リュ","リョ","ギャ","ギュ","ギョ","ジャ","ジュ","ジョ","ビャ","ビュ","ビョ","ピャ","ピュ","ピョ",
]);
const SPECIAL_KANA_CHARS = new Set(["っ", "ッ", "ん", "ン", "ー"]);

function loadFromStorage(key: string): AnyItem[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as AnyItem[];
    return [];
  } catch {
    return [];
  }
}

function saveToStorage(key: string, value: AnyItem[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function renderKanaItem(item: AnyItem, i: number): React.ReactNode {
  if (typeof item === "string") {
    return (
      <div key={i} style={{ marginBottom: "0.5rem" }}>
        {item}
      </div>
    );
  }
  const obj = item as Record<string, unknown>;
  return (
    <div
      key={i}
      style={{
        marginBottom: "0.5rem",
        border: "1px solid #eee",
        borderRadius: 6,
        padding: "0.5rem 0.75rem",
        background: "#fafafa",
      }}
    >
      <span style={{ fontSize: "1.4rem", fontWeight: "bold", marginRight: "0.5rem" }}>
        {typeof obj.char === "string" ? obj.char : ""}
      </span>
      {typeof obj.romaji === "string" && (
        <span style={{ color: "#555", marginRight: "0.5rem" }}>[{obj.romaji}]</span>
      )}
      {typeof obj.type === "string" && (
        <span
          style={{
            fontSize: "0.75rem",
            background: "#e0e7ff",
            color: "#3730a3",
            borderRadius: 4,
            padding: "0.1rem 0.4rem",
            marginRight: "0.4rem",
          }}
        >
          {obj.type}
        </span>
      )}
      {typeof obj.mode === "string" && (
        <span
          style={{
            fontSize: "0.75rem",
            background: "#fef3c7",
            color: "#92400e",
            borderRadius: 4,
            padding: "0.1rem 0.4rem",
            marginRight: "0.4rem",
          }}
        >
          {obj.mode}
        </span>
      )}
      {typeof obj.createdAt === "string" && (
        <span style={{ fontSize: "0.75rem", color: "#999", marginLeft: "0.2rem" }}>
          {formatDate(obj.createdAt)}
        </span>
      )}
    </div>
  );
}

function renderWordOrSentenceItem(item: AnyItem, i: number): React.ReactNode {
  if (typeof item === "string") {
    return (
      <span key={i} style={{ marginBottom: "0.3rem" }}>
        {item}
      </span>
    );
  }
  const obj = item as Record<string, unknown>;
  const parts: string[] = [];

  const mainFields = ["word", "japanese", "sentence"] as const;
  for (const f of mainFields) {
    if (typeof obj[f] === "string" && obj[f]) {
      parts.push(obj[f] as string);
      break;
    }
  }
  if (typeof obj.meaning === "string" && obj.meaning) {
    parts.push(`(${obj.meaning})`);
  }
  if (typeof obj.example === "string" && obj.example) {
    parts.push(`예: ${obj.example}`);
  }
  if (typeof obj.category === "string" && obj.category) {
    parts.push(`[${obj.category}]`);
  }
  if (typeof obj.note === "string" && obj.note) {
    parts.push(`※ ${obj.note}`);
  }

  const display = parts.length > 0 ? parts.join(" ") : JSON.stringify(obj);

  return <span key={i}>{display}</span>;
}

function getKanaQuizItems(items: AnyItem[]): KanaQuizItem[] {
  const result: KanaQuizItem[] = [];
  items.forEach((item) => {
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      if (typeof obj.char === "string" && obj.char && typeof obj.romaji === "string" && obj.romaji) {
        result.push({
          char: obj.char,
          romaji: obj.romaji,
          type: typeof obj.type === "string" ? obj.type : undefined,
          mode: typeof obj.mode === "string" ? obj.mode : undefined,
          createdAt: typeof obj.createdAt === "string" ? obj.createdAt : undefined,
        });
      }
    }
  });
  return result;
}

function getWordQuizItems(items: AnyItem[]): WordQuizItem[] {
  const result: WordQuizItem[] = [];
  items.forEach((item) => {
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      if (typeof obj.word === "string" && obj.word && typeof obj.meaning === "string" && obj.meaning) {
        const mode: WordQuizItem["mode"] = Math.random() < 0.5 ? "wordToMeaning" : "meaningToWord";
        result.push({
          word: obj.word,
          meaning: obj.meaning,
          category: typeof obj.category === "string" ? obj.category : undefined,
          quizType: typeof obj.quizType === "string" ? obj.quizType : undefined,
          createdAt: typeof obj.createdAt === "string" ? obj.createdAt : undefined,
          mode,
        });
      }
    }
  });
  return result;
}

function getSentenceQuizItems(items: AnyItem[]): SentenceQuizItem[] {
  const result: SentenceQuizItem[] = [];
  items.forEach((item) => {
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      if (
        typeof obj.japanese === "string" && obj.japanese &&
        typeof obj.meaning === "string" && obj.meaning
      ) {
        const mode: SentenceQuizItem["mode"] = Math.random() < 0.5 ? "japaneseToMeaning" : "meaningToJapanese";
        result.push({
          japanese: obj.japanese,
          meaning: obj.meaning,
          category: typeof obj.category === "string" ? obj.category : undefined,
          quizType: typeof obj.quizType === "string" ? obj.quizType : undefined,
          createdAt: typeof obj.createdAt === "string" ? obj.createdAt : undefined,
          mode,
        });
      }
    }
  });
  return result;
}

function isObjectItem(item: AnyItem): item is Record<string, unknown> {
  return typeof item === "object" && item !== null;
}

function getKanaWrongKey(item: AnyItem, includeCreatedAt?: boolean): string {
  if (!isObjectItem(item)) return "";
  const base = [
    typeof item.char === "string" ? item.char : "",
    typeof item.romaji === "string" ? item.romaji : "",
    typeof item.type === "string" ? item.type : "",
    typeof item.mode === "string" ? item.mode : "",
  ].join("|");
  const shouldIncludeCreatedAt = includeCreatedAt ?? typeof item.createdAt === "string";
  if (!shouldIncludeCreatedAt) return base;
  return `${base}|${typeof item.createdAt === "string" ? item.createdAt : ""}`;
}

function getWordWrongKey(item: AnyItem, includeCreatedAt?: boolean): string {
  if (!isObjectItem(item)) return "";
  const base = [
    typeof item.word === "string" ? item.word : "",
    typeof item.meaning === "string" ? item.meaning : "",
    typeof item.category === "string" ? item.category : "",
    typeof item.quizType === "string" ? item.quizType : "",
  ].join("|");
  const shouldIncludeCreatedAt = includeCreatedAt ?? typeof item.createdAt === "string";
  if (!shouldIncludeCreatedAt) return base;
  return `${base}|${typeof item.createdAt === "string" ? item.createdAt : ""}`;
}

function getSentenceWrongKey(item: AnyItem, includeCreatedAt?: boolean): string {
  if (!isObjectItem(item)) return "";
  const base = [
    typeof item.japanese === "string" ? item.japanese : "",
    typeof item.meaning === "string" ? item.meaning : "",
    typeof item.category === "string" ? item.category : "",
    typeof item.quizType === "string" ? item.quizType : "",
  ].join("|");
  const shouldIncludeCreatedAt = includeCreatedAt ?? typeof item.createdAt === "string";
  if (!shouldIncludeCreatedAt) return base;
  return `${base}|${typeof item.createdAt === "string" ? item.createdAt : ""}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateKanaOptions(correct: string, allItems: KanaQuizItem[]): string[] {
  const otherRomaji = allItems.map((x) => x.romaji).filter((r) => r !== correct);
  const pool = Array.from(new Set([...otherRomaji, ...ROMAJI_POOL])).filter((r) => r !== correct);
  const shuffled = shuffle(pool);
  const wrongs = shuffled.slice(0, 3);
  return shuffle([correct, ...wrongs]);
}

function generateWordOptions(correct: string, allItems: WordQuizItem[], field: "meaning" | "word", basePool?: string[]): string[] {
  const others = [
    ...(basePool ?? []),
    ...allItems.map((x) => x[field]),
  ].filter((v) => v !== correct);
  const unique = Array.from(new Set(others));
  const shuffled = shuffle(unique);
  const wrongs = shuffled.slice(0, 3);
  return shuffle([correct, ...wrongs]);
}

function generateSentenceOptions(correct: string, allItems: SentenceQuizItem[], field: "meaning" | "japanese", basePool?: string[]): string[] {
  const others = [
    ...(basePool ?? []),
    ...allItems.map((x) => x[field]),
  ].filter((v) => v !== correct);
  const unique = Array.from(new Set(others));
  const shuffled = shuffle(unique);
  const wrongs = shuffled.slice(0, 3);
  return shuffle([correct, ...wrongs]);
}

export default function ProgressPage() {
  const [data, setData] = useState<Record<SectionKey, AnyItem[]>>({
    wrongKana: [],
    wrongWords: [],
    wrongSentences: [],
  });


  const wordOptionPool = useMemo(() => ({
    meaning: Array.from(new Set(WORDS.map((item) => item.meaning).filter(Boolean))),
    word: Array.from(new Set(WORDS.map((item) => item.word).filter(Boolean))),
  }), []);

  const sentenceOptionPool = useMemo(() => ({
    meaning: Array.from(new Set(SENTENCES.map((item) => item.meaning).filter(Boolean))),
    japanese: Array.from(new Set(SENTENCES.map((item) => item.japanese).filter(Boolean))),
  }), []);

  // Kana Quiz state
  const [quizItems, setQuizItems] = useState<KanaQuizItem[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

  // Word Quiz state
  const [wordQuizItems, setWordQuizItems] = useState<WordQuizItem[]>([]);
  const [wordQuizIndex, setWordQuizIndex] = useState(0);
  const [wordOptions, setWordOptions] = useState<string[]>([]);
  const [wordSelected, setWordSelected] = useState<string | null>(null);
  const [wordIsCorrect, setWordIsCorrect] = useState<boolean | null>(null);

  // Sentence Quiz state
  const [sentenceQuizItems, setSentenceQuizItems] = useState<SentenceQuizItem[]>([]);
  const [sentenceQuizIndex, setSentenceQuizIndex] = useState(0);
  const [sentenceOptions, setSentenceOptions] = useState<string[]>([]);
  const [sentenceSelected, setSentenceSelected] = useState<string | null>(null);
  const [sentenceIsCorrect, setSentenceIsCorrect] = useState<boolean | null>(null);
  const [confusingKanaChars, setConfusingKanaChars] = useState<string[]>([]);
  const [grammarProgress, setGrammarProgress] = useState<GrammarProgressItem[]>([]);
  const [activeProgressTab, setActiveProgressTab] = useState<ProgressTab>("all");
  const [curriculumProgress, setCurriculumProgress] = useState<CurriculumProgress | null>(null);
  const [curriculumReviewCount, setCurriculumReviewCount] = useState(0);

  const buildKanaQuiz = useCallback((items: AnyItem[]) => {
    const qi = getKanaQuizItems(items);
    const shuffled = shuffle(qi);
    setQuizItems(shuffled);
    setQuizIndex(0);
    setSelected(null);
    setIsCorrect(null);
    if (shuffled.length > 0) {
      setOptions(generateKanaOptions(shuffled[0].romaji, shuffled));
    } else {
      setOptions([]);
    }
  }, []);

  const buildWordQuiz = useCallback((items: AnyItem[]) => {
    const qi = getWordQuizItems(items);
    const shuffled = shuffle(qi);
    setWordQuizItems(shuffled);
    setWordQuizIndex(0);
    setWordSelected(null);
    setWordIsCorrect(null);
    if (shuffled.length > 0) {
      const first = shuffled[0];
      const correctVal = first.mode === "wordToMeaning" ? first.meaning : first.word;
      const field: "meaning" | "word" = first.mode === "wordToMeaning" ? "meaning" : "word";
      setWordOptions(generateWordOptions(correctVal, shuffled, field, wordOptionPool[field]));
    } else {
      setWordOptions([]);
    }
  }, [wordOptionPool]);

  const buildSentenceQuiz = useCallback((items: AnyItem[]) => {
    const qi = getSentenceQuizItems(items);
    const shuffled = shuffle(qi);
    setSentenceQuizItems(shuffled);
    setSentenceQuizIndex(0);
    setSentenceSelected(null);
    setSentenceIsCorrect(null);
    if (shuffled.length > 0) {
      const first = shuffled[0];
      const correctVal = first.mode === "japaneseToMeaning" ? first.meaning : first.japanese;
      const field: "meaning" | "japanese" = first.mode === "japaneseToMeaning" ? "meaning" : "japanese";
      setSentenceOptions(generateSentenceOptions(correctVal, shuffled, field, sentenceOptionPool[field]));
    } else {
      setSentenceOptions([]);
    }
  }, [sentenceOptionPool]);

  useEffect(() => {
    const wrongKana = loadFromStorage("wrongKana");
    const wrongWords = loadFromStorage("wrongWords");
    const wrongSentences = loadFromStorage("wrongSentences");
    let grammarItems: GrammarProgressItem[] = [];
    try {
      const rawGrammar = localStorage.getItem(GRAMMAR_PROGRESS_KEY);
      if (rawGrammar) {
        const parsed = JSON.parse(rawGrammar);
        if (Array.isArray(parsed)) grammarItems = parsed as GrammarProgressItem[];
      }
    } catch {
      grammarItems = [];
    }
    setData({ wrongKana, wrongWords, wrongSentences });
    setGrammarProgress(grammarItems);
    setCurriculumProgress(loadCurriculumProgress());
    setCurriculumReviewCount(loadFromStorage(CURRICULUM_REVIEW_KEY).length);
    const rawConfusingKana = loadFromStorage("wrongKanaChars");
    const rawConfusingKanaLegacy = loadFromStorage("confusingKana");
    const confusingChars = [...rawConfusingKana, ...rawConfusingKanaLegacy]
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null && typeof item.char === "string") return item.char;
        return "";
      })
      .filter(Boolean);
    setConfusingKanaChars(Array.from(new Set(confusingChars)));
    buildKanaQuiz(wrongKana);
    buildWordQuiz(wrongWords);
    buildSentenceQuiz(wrongSentences);
  }, [buildKanaQuiz, buildWordQuiz, buildSentenceQuiz]);

  const kanaSummaryCards: KanaSummaryCard[] = useMemo(() => {
    const wrongKanaItems = getKanaQuizItems(data.wrongKana);
    const groupConfig = [
      { key: "basic" as const, label: "기본 46자", total: 46, set: BASIC_KANA_CHARS },
      { key: "dakuon" as const, label: "탁음/반탁음", total: 25, set: DAKUON_KANA_CHARS },
      { key: "youon" as const, label: "요음", total: 33, set: YOON_KANA_CHARS },
      { key: "special" as const, label: "특수 발음", total: 3, set: SPECIAL_KANA_CHARS },
    ];
    return groupConfig.map((group) => {
      const wrongCount = wrongKanaItems.filter((item) => group.set.has(item.char)).length;
      const confusingCount = confusingKanaChars.filter((char) => group.set.has(char)).length;
      const statusText = wrongCount === 0 ? "오답 없음" : wrongCount <= 3 ? "복습 권장" : "집중 복습 필요";
      const statusColor = wrongCount === 0 ? "#166534" : wrongCount <= 3 ? "#9a3412" : "#991b1b";
      const bgColor = wrongCount === 0 ? "#dcfce7" : wrongCount <= 3 ? "#ffedd5" : "#fee2e2";
      return { key: group.key, label: group.label, total: group.total, wrongCount, confusingCount, statusText, statusColor, bgColor };
    });
  }, [confusingKanaChars, data.wrongKana]);

  const kanaTopWrongItems: KanaTopWrongItem[] = useMemo(() => {
    const map = new Map<string, KanaTopWrongItem>();
    getKanaQuizItems(data.wrongKana).forEach((item) => {
      const prev = map.get(item.char);
      const createdAt = item.createdAt;
      if (!prev) {
        map.set(item.char, { char: item.char, romaji: item.romaji, count: 1, lastWrongAt: createdAt });
        return;
      }
      const prevTime = prev.lastWrongAt ? new Date(prev.lastWrongAt).getTime() : 0;
      const curTime = createdAt ? new Date(createdAt).getTime() : 0;
      map.set(item.char, {
        ...prev,
        count: prev.count + 1,
        lastWrongAt: curTime > prevTime ? createdAt : prev.lastWrongAt,
      });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [data.wrongKana]);

  const grammarSummary = useMemo(() => {
    const total = GRAMMAR_LESSONS.length;
    const solved = grammarProgress.length;
    const correctTotal = grammarProgress.reduce((sum, item) => sum + item.correctCount, 0);
    const wrongTotal = grammarProgress.reduce((sum, item) => sum + item.wrongCount, 0);
    const reviewCount = grammarProgress.filter((item) => item.wrongCount > 0 || item.lastResult === "wrong").length;
    return { total, solved, correctTotal, wrongTotal, reviewCount };
  }, [grammarProgress]);

  const topWrongGrammar = useMemo(
    () => grammarProgress.filter((item) => item.wrongCount > 0).sort((a, b) => b.wrongCount - a.wrongCount).slice(0, 10),
    [grammarProgress],
  );

  function clearSection(key: SectionKey) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    setData((prev) => {
      const next = { ...prev, [key]: [] };
      if (key === "wrongKana") {
        buildKanaQuiz([]);
      }
      if (key === "wrongWords") {
        buildWordQuiz([]);
      }
      if (key === "wrongSentences") {
        buildSentenceQuiz([]);
      }
      return next;
    });
  }

  function handleClearSection(key: SectionKey) {
    const confirmMessages: Record<SectionKey, string> = {
      wrongKana: "헷갈린 글자 오답을 모두 삭제할까요?",
      wrongWords: "틀린 단어 오답을 모두 삭제할까요?",
      wrongSentences: "틀린 문장 오답을 모두 삭제할까요?",
    };

    if (!window.confirm(confirmMessages[key])) return;
    clearSection(key);
  }

  function removeWrongKanaItem(target: AnyItem) {
    if (!isObjectItem(target)) return;
    const useCreatedAt = typeof target.createdAt === "string";
    const targetKey = getKanaWrongKey(target, useCreatedAt);

    setData((prev) => {
      let removed = false;
      const updated = prev.wrongKana.filter((storedItem) => {
        if (removed) return true;
        const storedKey = getKanaWrongKey(storedItem, useCreatedAt);
        if (storedKey === targetKey) {
          removed = true;
          return false;
        }
        return true;
      });
      saveToStorage("wrongKana", updated);
      buildKanaQuiz(updated);
      return { ...prev, wrongKana: updated };
    });
  }

  function removeWrongWordItem(target: AnyItem) {
    if (!isObjectItem(target)) return;
    const useCreatedAt = typeof target.createdAt === "string";
    const targetKey = getWordWrongKey(target, useCreatedAt);

    setData((prev) => {
      let removed = false;
      const updated = prev.wrongWords.filter((storedItem) => {
        if (removed) return true;
        const storedKey = getWordWrongKey(storedItem, useCreatedAt);
        if (storedKey === targetKey) {
          removed = true;
          return false;
        }
        return true;
      });
      saveToStorage("wrongWords", updated);
      buildWordQuiz(updated);
      return { ...prev, wrongWords: updated };
    });
  }

  function removeWrongSentenceItem(target: AnyItem) {
    if (!isObjectItem(target)) return;
    const useCreatedAt = typeof target.createdAt === "string";
    const targetKey = getSentenceWrongKey(target, useCreatedAt);

    setData((prev) => {
      let removed = false;
      const updated = prev.wrongSentences.filter((storedItem) => {
        if (removed) return true;
        const storedKey = getSentenceWrongKey(storedItem, useCreatedAt);
        if (storedKey === targetKey) {
          removed = true;
          return false;
        }
        return true;
      });
      saveToStorage("wrongSentences", updated);
      buildSentenceQuiz(updated);
      return { ...prev, wrongSentences: updated };
    });
  }

  // Kana quiz handlers
  function handleOptionSelect(opt: string) {
    if (selected !== null) return;
    const current = quizItems[quizIndex];
    if (!current) return;

    const correct = opt === current.romaji;
    setSelected(opt);
    setIsCorrect(correct);

    if (correct) {
      removeWrongKanaItem(current);
      setQuizItems((prev) => prev.filter((_, i) => i !== quizIndex));
    }
  }

  function handleNext() {
    setSelected(null);
    setIsCorrect(null);

    setQuizItems((prev) => {
      const nextIndex = isCorrect
        ? quizIndex >= prev.length ? prev.length - 1 : quizIndex
        : (quizIndex + 1) % Math.max(prev.length, 1);
      const clampedIndex = Math.min(nextIndex, prev.length - 1);

      setQuizIndex(clampedIndex);
      if (prev.length > 0) {
        setOptions(generateKanaOptions(prev[clampedIndex]?.romaji ?? "", prev));
      }
      return prev;
    });
  }

  // Word quiz handlers
  function handleWordOptionSelect(opt: string) {
    if (wordSelected !== null) return;
    const current = wordQuizItems[wordQuizIndex];
    if (!current) return;

    const correctVal = current.mode === "wordToMeaning" ? current.meaning : current.word;
    const correct = opt === correctVal;
    setWordSelected(opt);
    setWordIsCorrect(correct);

  }

  function handleWordNext() {
    const wasCorrect = wordIsCorrect;
    const current = wordQuizItems[wordQuizIndex];

    if (wasCorrect && current) {
      removeWrongWordItem(current);
      return;
    }

    const nextIndex = (wordQuizIndex + 1) % Math.max(wordQuizItems.length, 1);
    const nextItem = wordQuizItems[nextIndex];

    setWordSelected(null);
    setWordIsCorrect(null);
    setWordQuizIndex(nextIndex);

    if (nextItem) {
      const field: "meaning" | "word" = nextItem.mode === "wordToMeaning" ? "meaning" : "word";
      const correctVal = nextItem.mode === "wordToMeaning" ? nextItem.meaning : nextItem.word;
      setWordOptions(generateWordOptions(correctVal, wordQuizItems, field, wordOptionPool[field]));
    }
  }

  // Sentence quiz handlers
  function handleSentenceOptionSelect(opt: string) {
    if (sentenceSelected !== null) return;
    const current = sentenceQuizItems[sentenceQuizIndex];
    if (!current) return;

    const correctVal = current.mode === "japaneseToMeaning" ? current.meaning : current.japanese;
    const correct = opt === correctVal;
    setSentenceSelected(opt);
    setSentenceIsCorrect(correct);

  }

  function handleSentenceNext() {
    const wasCorrect = sentenceIsCorrect;
    const current = sentenceQuizItems[sentenceQuizIndex];

    if (wasCorrect && current) {
      removeWrongSentenceItem(current);
      return;
    }

    const nextIndex = (sentenceQuizIndex + 1) % Math.max(sentenceQuizItems.length, 1);
    const nextItem = sentenceQuizItems[nextIndex];

    setSentenceSelected(null);
    setSentenceIsCorrect(null);
    setSentenceQuizIndex(nextIndex);

    if (nextItem) {
      const field: "meaning" | "japanese" = nextItem.mode === "japaneseToMeaning" ? "meaning" : "japanese";
      const correctVal = nextItem.mode === "japaneseToMeaning" ? nextItem.meaning : nextItem.japanese;
      setSentenceOptions(generateSentenceOptions(correctVal, sentenceQuizItems, field, sentenceOptionPool[field]));
    }
  }

  const learningSummary = useMemo(() => {
    const kanaCount = data.wrongKana.length + confusingKanaChars.length;
    const wordsCount = data.wrongWords.length;
    const sentencesCount = data.wrongSentences.length;
    const grammarCount = grammarSummary.reviewCount;
    const reviewTotal = kanaCount + wordsCount + sentencesCount + grammarCount + curriculumReviewCount;
    return { kanaCount, wordsCount, sentencesCount, grammarCount, curriculumReviewCount, reviewTotal };
  }, [confusingKanaChars.length, curriculumReviewCount, data.wrongKana.length, data.wrongWords.length, data.wrongSentences.length, grammarSummary.reviewCount]);

  const progressTabs: { key: ProgressTab; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "kana", label: "가나" },
    { key: "words", label: "단어" },
    { key: "sentences", label: "문장" },
    { key: "grammar", label: "문법" },
  ];

  const showAll = activeProgressTab === "all";
  const showKana = showAll || activeProgressTab === "kana";
  const showWords = showAll || activeProgressTab === "words";
  const showSentences = showAll || activeProgressTab === "sentences";
  const showGrammar = showAll || activeProgressTab === "grammar";

  const currentQuiz = quizItems[quizIndex] ?? null;
  const currentWordQuiz = wordQuizItems[wordQuizIndex] ?? null;
  const currentSentenceQuiz = sentenceQuizItems[sentenceQuizIndex] ?? null;

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "1.5rem 1rem 3rem", color: "#0f172a" }}>
      <section style={{ marginBottom: "1.1rem", border: "1px solid #dbeafe", borderRadius: 20, padding: "1.2rem", background: "linear-gradient(145deg, #f8fbff 0%, #eef4ff 100%)", boxShadow: "0 10px 28px rgba(59, 130, 246, 0.08)" }}>
        <h1 style={{ fontSize: "1.8rem", margin: "0 0 0.5rem", color: "#1e3a8a" }}>학습 진도</h1>
        <p style={{ color: "#334155", margin: 0, lineHeight: 1.55 }}>
          오늘까지 쌓은 학습 기록을 한눈에 확인해 보세요.
        </p>
      </section>

      <section style={{ marginBottom: "1rem", border: "1px solid #dbeafe", borderRadius: 20, padding: "1rem", background: "#ffffff", boxShadow: "0 6px 20px rgba(148, 163, 184, 0.16)" }}>
        <h2 style={{ fontSize: "1.05rem", margin: "0 0 0.8rem", color: "#1f684c" }}>새 학습 과정</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(105px,1fr))", gap: "0.55rem", marginBottom: "0.7rem" }}>
          <div style={{ padding: "0.7rem", borderRadius: 12, background: "#f3faf6", textAlign: "center" }}><small>연속 학습</small><strong style={{ display: "block", color: "#287a59" }}>{getCurrentStreak(curriculumProgress?.activityDates ?? [])}일</strong></div>
          <div style={{ padding: "0.7rem", borderRadius: 12, background: "#f3faf6", textAlign: "center" }}><small>총 학습일</small><strong style={{ display: "block", color: "#287a59" }}>{curriculumProgress?.activityDates.length ?? 0}일</strong></div>
          <div style={{ padding: "0.7rem", borderRadius: 12, background: "#f3faf6", textAlign: "center" }}><small>수업 시도</small><strong style={{ display: "block", color: "#287a59" }}>{Object.values(curriculumProgress?.lessonAttempts ?? {}).reduce((sum, attempts) => sum + attempts.length, 0)}회</strong></div>
          <div style={{ padding: "0.7rem", borderRadius: 12, background: "#f3faf6", textAlign: "center" }}><small>평균 점수</small><strong style={{ display: "block", color: "#287a59" }}>{(() => { const scores = Object.values(curriculumProgress?.lessonAttempts ?? {}).flat().map((attempt) => attempt.score); return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0; })()}점</strong></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.55rem" }}>
          {(["foundation", "work", "travel"] as CourseTrack[]).map((track) => {
            const trackLessons = CURRICULUM.filter((lesson) => lesson.track === track);
            const completed = trackLessons.filter((lesson) => curriculumProgress?.completedLessonIds.includes(lesson.id)).length;
            return <Link key={track} href={`/language/learn?track=${track}`} style={{ padding: "0.8rem 0.5rem", borderRadius: 14, textAlign: "center", textDecoration: "none", color: "#254d3c", background: track === "work" ? "#eaf2fa" : track === "travel" ? "#fff0e9" : "#e8f6ee", border: "1px solid #dce7e1" }}><small style={{ display: "block", marginBottom: 4 }}>{TRACKS[track].title}</small><strong style={{ fontSize: "1.2rem" }}>{completed}/{trackLessons.length}</strong></Link>;
          })}
        </div>
        <Link href={curriculumProgress?.lastLessonId ? `/language/learn?lesson=${curriculumProgress.lastLessonId}` : "/language/learn"} style={{ display: "block", marginTop: "0.7rem", padding: "0.65rem", borderRadius: 10, textAlign: "center", textDecoration: "none", color: "#fff", background: "#287a59", fontWeight: 750, fontSize: "0.85rem" }}>{curriculumProgress?.completedLessonIds.length ? "최근 수업 다시 보기" : "첫 10분 학습 시작"}</Link>
      </section>

      <section style={{ marginBottom: "1rem", border: "1px solid #dbeafe", borderRadius: 20, padding: "1rem", background: "#ffffff", boxShadow: "0 6px 20px rgba(148, 163, 184, 0.16)" }}>
        <h2 style={{ fontSize: "1.05rem", margin: "0 0 0.8rem", color: "#1e3a8a" }}>학습 요약</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "0.55rem" }}>
          {[
            { label: "가나", value: learningSummary.kanaCount, tone: "#e0e7ff" },
            { label: "단어", value: learningSummary.wordsCount, tone: "#dbeafe" },
            { label: "문장", value: learningSummary.sentencesCount, tone: "#fef3c7" },
            { label: "문법", value: learningSummary.grammarCount, tone: "#ffe4e6" },
            { label: "복습 필요", value: learningSummary.reviewTotal, tone: "#dbeafe" },
          ].map((item) => (
            <article key={item.label} style={{ border: "1px solid #dbeafe", borderRadius: 14, padding: "0.7rem 0.55rem", background: item.tone }}>
              <div style={{ fontSize: "0.76rem", color: "#475569" }}>{item.label}</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#1e3a8a", marginTop: "0.1rem" }}>{item.value}</div>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", background: "#eff6ff", padding: "0.35rem", borderRadius: 999, border: "1px solid #dbeafe" }}>
          {progressTabs.map((tab) => {
            const active = activeProgressTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveProgressTab(tab.key)}
                style={{
                  border: active ? "1px solid #2563eb" : "1px solid transparent",
                  background: active ? "#2563eb" : "transparent",
                  color: active ? "#fff" : "#334155",
                  padding: "0.46rem 0.95rem",
                  borderRadius: 999,
                  fontWeight: 600,
                  fontSize: "0.86rem",
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {showGrammar && (
      <section style={{ marginBottom: "2rem", border: "1px solid #dbeafe", borderRadius: 18, padding: "1rem", background: "#ffffff", boxShadow: "0 6px 20px rgba(148, 163, 184, 0.12)" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>문법 진도</h2>
        <article style={{ border: "1px solid #dbeafe", borderRadius: 14, padding: "1rem", marginBottom: "0.75rem", background: "#f8fbff" }}>
          <p style={{ margin: "0 0 6px" }}>전체 {grammarSummary.total}개 · 풀이 {grammarSummary.solved}개</p>
          <p style={{ margin: "0 0 6px" }}>정답 {grammarSummary.correctTotal}회 · 오답 {grammarSummary.wrongTotal}회</p>
          <p style={{ margin: 0 }}>복습 필요 {grammarSummary.reviewCount}개</p>
        </article>
        <article style={{ border: "1px solid #dbeafe", borderRadius: 14, padding: "1rem", background: "#f8fbff" }}>
          <h3 style={{ marginTop: 0 }}>자주 틀린 문법</h3>
          {topWrongGrammar.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{activeProgressTab === "grammar" ? "문법 복습 항목이 없습니다. [문법]에서 연습 문제를 풀어 보세요." : "아직 틀린 문법 기록이 없습니다."}</p>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {topWrongGrammar.map((item) => (
                <div key={item.lessonId} style={{ border: "1px solid #eee", borderRadius: 8, padding: "10px" }}>
                  <div style={{ fontWeight: 700 }}>{item.title}</div>
                  <div className="muted" style={{ fontSize: "13px" }}>{item.category} · {item.pattern}</div>
                  <div style={{ fontSize: "13px", marginTop: 4 }}>오답 {item.wrongCount}회 · 최근 {item.lastResult === "correct" ? "정답" : "오답"}</div>
                  <Link href={`/language/grammar?lesson=${item.lessonId}`}>문법 다시 학습</Link>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
      )}

      {showKana && (
      <>
      <section style={{ marginBottom: "2rem", border: "1px solid #dbeafe", borderRadius: 18, padding: "1rem", background: "#ffffff", boxShadow: "0 6px 20px rgba(148, 163, 184, 0.12)" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>가나 진도 요약</h2>
        {activeProgressTab === "kana" && data.wrongKana.length === 0 && confusingKanaChars.length === 0 && (
          <p style={{ color: "#6b7280", margin: "0 0 0.75rem" }}>가나 오답이 없습니다. [가나]에서 퀴즈를 풀어 보세요.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" style={{ gap: "0.75rem" }}>
          {kanaSummaryCards.map((card) => (
            <article key={card.key} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.85rem", background: "#fff" }}>
              <h3 style={{ fontSize: "1rem", margin: "0 0 0.4rem 0" }}>{card.label}</h3>
              <p style={{ margin: "0 0 0.35rem 0", fontSize: "0.86rem", color: "#4b5563" }}>
                전체 {card.total}자 · 오답 {card.wrongCount}개 · 헷갈림 {card.confusingCount}개
              </p>
              <p style={{ margin: "0 0 0.65rem 0", fontSize: "0.8rem", fontWeight: 700, color: card.statusColor, background: card.bgColor, display: "inline-block", padding: "0.15rem 0.45rem", borderRadius: 999 }}>
                {card.statusText}
              </p>
              <Link href="/language/kana" style={{ display: "inline-block", fontSize: "0.8rem", padding: "0.25rem 0.6rem", borderRadius: 4, textDecoration: "none", background: "#3730a3", color: "#fff" }}>
                가나 퀴즈 다시 풀기
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: "2rem", border: "1px solid #dbeafe", borderRadius: 18, padding: "1rem", background: "#ffffff", boxShadow: "0 6px 20px rgba(148, 163, 184, 0.12)" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>자주 틀린 가나</h2>
        {kanaTopWrongItems.length === 0 ? (
          <p style={{ color: "#999", margin: 0 }}>기록된 가나 오답이 없습니다.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}>
            {kanaTopWrongItems.map((item) => (
              <li key={item.char} style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", alignItems: "center", border: "1px solid #eee", borderRadius: 6, padding: "0.5rem 0.65rem", background: "#fafafa" }}>
                <div>
                  <strong style={{ fontSize: "1.1rem", marginRight: "0.3rem" }}>{item.char}</strong>
                  <span style={{ color: "#4b5563", fontSize: "0.88rem" }}>
                    / {item.romaji} · {item.count}회
                  </span>
                  <div style={{ color: "#6b7280", fontSize: "0.75rem", marginTop: "0.1rem" }}>
                    {item.lastWrongAt ? `마지막 틀림: ${formatDate(item.lastWrongAt)}` : "최근 틀림"}
                  </div>
                </div>
                <Link href="/language/kana" style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem", borderRadius: 4, textDecoration: "none", background: "#111827", color: "#fff", whiteSpace: "nowrap" }}>
                  다시 학습
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 가나 오답 퀴즈 섹션 */}
      <section
        style={{
          marginBottom: "2rem",
          border: "1px solid #bfdbfe",
          borderRadius: 18,
          padding: "1rem",
          background: "#f8fbff",
        }}
      >
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>가나 오답 다시 풀기</h2>

        {quizItems.length === 0 ? (
          <p style={{ color: "#999", margin: 0 }}>가나 오답이 없습니다.</p>
        ) : currentQuiz ? (
          <div>
            <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "0.5rem" }}>
              남은 오답: {quizItems.length}개
            </p>
            <div
              style={{
                fontSize: "3rem",
                fontWeight: "bold",
                textAlign: "center",
                padding: "1.2rem 0",
                background: "#fff",
                borderRadius: 8,
                border: "1px solid #ddd",
                marginBottom: "1rem",
                letterSpacing: "0.05em",
              }}
            >
              {currentQuiz.char}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.5rem",
                marginBottom: "0.75rem",
              }}
            >
              {options.map((opt) => {
                let bg = "#fff";
                let border = "1px solid #ccc";
                let color = "#111";
                if (selected !== null) {
                  if (opt === currentQuiz.romaji) {
                    bg = "#d1fae5";
                    border = "1px solid #34d399";
                    color = "#065f46";
                  } else if (opt === selected && !isCorrect) {
                    bg = "#fee2e2";
                    border = "1px solid #f87171";
                    color = "#991b1b";
                  }
                }
                return (
                  <button
                    key={opt}
                    onClick={() => handleOptionSelect(opt)}
                    disabled={selected !== null}
                    style={{
                      padding: "0.6rem 0.5rem",
                      fontSize: "1rem",
                      borderRadius: 6,
                      border,
                      background: bg,
                      color,
                      cursor: selected !== null ? "default" : "pointer",
                      fontWeight: opt === currentQuiz.romaji && selected !== null ? "bold" : "normal",
                      transition: "background 0.15s",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            {selected !== null && (
              <div style={{ marginBottom: "0.75rem", textAlign: "center" }}>
                {isCorrect ? (
                  <span style={{ color: "#065f46", fontWeight: "bold", fontSize: "0.95rem" }}>
                    ✅ 정답입니다! 오답 목록에서 정리했습니다.
                  </span>
                ) : (
                  <span style={{ color: "#991b1b", fontWeight: "bold", fontSize: "0.95rem" }}>
                    ❌ 오답입니다. 정답은 [{currentQuiz.romaji}]입니다.
                  </span>
                )}
              </div>
            )}

            {selected !== null && (
              <div style={{ textAlign: "center" }}>
                <button
                  onClick={handleNext}
                  style={{
                    padding: "0.5rem 1.2rem",
                    fontSize: "0.9rem",
                    borderRadius: 6,
                    border: "1px solid #a5b4fc",
                    background: "#4f46e5",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  다음 오답 →
                </button>
              </div>
            )}
          </div>
        ) : null}
      </section>
      </>
      )}

      {/* 단어 오답 퀴즈 섹션 */}
      {showWords && (
      <section
        style={{
          marginBottom: "2rem",
          border: "1px solid #bfdbfe",
          borderRadius: 18,
          padding: "1rem",
          background: "#f8fbff",
        }}
      >
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>단어 오답 다시 풀기</h2>

        {wordQuizItems.length === 0 ? (
          <p style={{ color: "#64748b", margin: 0 }}>아직 단어 오답 기록이 없어요. [단어] 퀴즈를 풀면 기록이 여기에 쌓여요.</p>
        ) : currentWordQuiz ? (
          <div>
            <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "0.5rem" }}>
              남은 오답: {wordQuizItems.length}개
            </p>
            <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.5rem" }}>
              {currentWordQuiz.mode === "wordToMeaning" ? "단어의 뜻을 고르세요" : "뜻에 맞는 단어를 고르세요"}
            </p>
            <div
              style={{
                fontSize: "2rem",
                fontWeight: "bold",
                textAlign: "center",
                padding: "1rem 0",
                background: "#fff",
                borderRadius: 8,
                border: "1px solid #ddd",
                marginBottom: "1rem",
                letterSpacing: "0.03em",
              }}
            >
              {currentWordQuiz.mode === "wordToMeaning" ? currentWordQuiz.word : currentWordQuiz.meaning}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.5rem",
                marginBottom: "0.75rem",
              }}
            >
              {wordOptions.map((opt) => {
                const correctVal = currentWordQuiz.mode === "wordToMeaning"
                  ? currentWordQuiz.meaning
                  : currentWordQuiz.word;
                let bg = "#fff";
                let border = "1px solid #ccc";
                let color = "#111";
                if (wordSelected !== null) {
                  if (opt === correctVal) {
                    bg = "#16a34a";
                    border = "1px solid #16a34a";
                    color = "#ffffff";
                  } else if (opt === wordSelected && !wordIsCorrect) {
                    bg = "#fee2e2";
                    border = "1px solid #f87171";
                    color = "#991b1b";
                  }
                }
                return (
                  <button
                    key={opt}
                    onClick={() => handleWordOptionSelect(opt)}
                    disabled={wordSelected !== null}
                    style={{
                      padding: "0.6rem 0.5rem",
                      fontSize: "0.95rem",
                      borderRadius: 6,
                      border,
                      background: bg,
                      color,
                      cursor: wordSelected !== null ? "default" : "pointer",
                      fontWeight: opt === correctVal && wordSelected !== null ? "bold" : "normal",
                      transition: "background 0.15s",
                      wordBreak: "keep-all",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            {wordSelected !== null && (
              <div style={{ marginBottom: "0.75rem", textAlign: "center" }}>
                {wordIsCorrect ? (
                  <span style={{ color: "#065f46", fontWeight: "bold", fontSize: "0.95rem" }}>
                    ✅ 정답입니다!
                  </span>
                ) : (
                  <span style={{ color: "#991b1b", fontWeight: "bold", fontSize: "0.95rem" }}>
                    ❌ 오답입니다. 정답은 [{currentWordQuiz.mode === "wordToMeaning" ? currentWordQuiz.meaning : currentWordQuiz.word}]입니다.
                  </span>
                )}
              </div>
            )}

            {wordSelected !== null && (
              <div style={{ textAlign: "center" }}>
                <button
                  onClick={handleWordNext}
                  style={{
                    padding: "0.5rem 1.2rem",
                    fontSize: "0.9rem",
                    borderRadius: 6,
                    border: wordIsCorrect ? "1px solid #16a34a" : "1px solid #6ee7b7",
                    background: wordIsCorrect ? "#16a34a" : "#059669",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  다음 단어 오답 →
                </button>
              </div>
            )}
          </div>
        ) : null}
      </section>
      )}

      {/* 문장 오답 퀴즈 섹션 */}
      {showSentences && (
      <section
        style={{
          marginBottom: "2rem",
          border: "1px solid #bfdbfe",
          borderRadius: 18,
          padding: "1rem",
          background: "#f8fbff",
        }}
      >
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>문장 오답 다시 풀기</h2>

        {sentenceQuizItems.length === 0 ? (
          <p style={{ color: "#64748b", margin: 0 }}>아직 문장 오답 기록이 없어요. [문장] 퀴즈를 풀면 기록이 여기에 쌓여요.</p>
        ) : currentSentenceQuiz ? (
          <div>
            <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "0.5rem" }}>
              남은 오답: {sentenceQuizItems.length}개
            </p>
            <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.5rem" }}>
              {currentSentenceQuiz.mode === "japaneseToMeaning"
                ? "문장의 뜻을 고르세요"
                : "뜻에 맞는 일본어 문장을 고르세요"}
            </p>
            <div
              style={{
                fontSize: "1.3rem",
                fontWeight: "bold",
                textAlign: "center",
                padding: "1rem",
                background: "#fff",
                borderRadius: 8,
                border: "1px solid #ddd",
                marginBottom: "1rem",
                lineHeight: 1.6,
                wordBreak: "keep-all",
              }}
            >
              {currentSentenceQuiz.mode === "japaneseToMeaning"
                ? currentSentenceQuiz.japanese
                : currentSentenceQuiz.meaning}
            </div>

            <div
              className="grid grid-cols-1 sm:grid-cols-2"
              style={{
                gap: "0.5rem",
                marginBottom: "0.75rem",
              }}
            >
              {sentenceOptions.map((opt) => {
                const correctVal = currentSentenceQuiz.mode === "japaneseToMeaning"
                  ? currentSentenceQuiz.meaning
                  : currentSentenceQuiz.japanese;
                let bg = "#fff";
                let border = "1px solid #ccc";
                let color = "#111";
                if (sentenceSelected !== null) {
                  if (opt === correctVal) {
                    bg = "#16a34a";
                    border = "1px solid #16a34a";
                    color = "#ffffff";
                  } else if (opt === sentenceSelected && !sentenceIsCorrect) {
                    bg = "#fee2e2";
                    border = "1px solid #f87171";
                    color = "#991b1b";
                  }
                }
                return (
                  <button
                    key={opt}
                    onClick={() => handleSentenceOptionSelect(opt)}
                    disabled={sentenceSelected !== null}
                    style={{
                      padding: "0.6rem 0.5rem",
                      fontSize: "0.85rem",
                      borderRadius: 6,
                      border,
                      background: bg,
                      color,
                      cursor: sentenceSelected !== null ? "default" : "pointer",
                      fontWeight: opt === correctVal && sentenceSelected !== null ? "bold" : "normal",
                      transition: "background 0.15s",
                      wordBreak: "break-word",
                      whiteSpace: "normal",
                      lineHeight: 1.4,
                      textAlign: "left",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            {sentenceSelected !== null && (
              <div style={{ marginBottom: "0.75rem", textAlign: "center" }}>
                {sentenceIsCorrect ? (
                  <span style={{ color: "#065f46", fontWeight: "bold", fontSize: "0.95rem" }}>
                    ✅ 정답입니다!
                  </span>
                ) : (
                  <span style={{ color: "#991b1b", fontWeight: "bold", fontSize: "0.95rem" }}>
                    ❌ 오답입니다. 정답은 [{currentSentenceQuiz.mode === "japaneseToMeaning"
                      ? currentSentenceQuiz.meaning
                      : currentSentenceQuiz.japanese}]입니다.
                  </span>
                )}
              </div>
            )}

            {sentenceSelected !== null && (
              <div style={{ textAlign: "center" }}>
                <button
                  onClick={handleSentenceNext}
                  style={{
                    padding: "0.5rem 1.2rem",
                    fontSize: "0.9rem",
                    borderRadius: 6,
                    border: sentenceIsCorrect ? "1px solid #16a34a" : "1px solid #fbbf24",
                    background: sentenceIsCorrect ? "#16a34a" : "#d97706",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  다음 문장 오답 →
                </button>
              </div>
            )}
          </div>
        ) : null}
      </section>
      )}

      {((showKana && activeProgressTab !== "all") || showWords || showSentences) && SECTIONS.map(({ key, label, href, linkLabel }) => {
        const items = data[key];
        if ((activeProgressTab === "kana" && key !== "wrongKana") || (activeProgressTab === "words" && key !== "wrongWords") || (activeProgressTab === "sentences" && key !== "wrongSentences")) return null;
        return (
          <section
            key={key}
            style={{
              marginBottom: "2rem",
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: "1rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.75rem",
              }}
            >
              <h2 style={{ fontSize: "1.1rem", margin: 0 }}>{label}</h2>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <Link
                  href={href}
                  style={{
                    fontSize: "0.8rem",
                    padding: "0.25rem 0.7rem",
                    background: "#3730a3",
                    color: "#fff",
                    borderRadius: 4,
                    textDecoration: "none",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {linkLabel}
                </Link>
                {items.length > 0 && (
                  <button
                    onClick={() => handleClearSection(key)}
                    style={{
                      fontSize: "0.8rem",
                      padding: "0.25rem 0.6rem",
                      cursor: "pointer",
                      background: "#fff",
                      border: "1px solid #ccc",
                      borderRadius: 4,
                      color: "#c00",
                    }}
                  >
                    전체 삭제
                  </button>
                )}
              </div>
            </div>

            {items.length === 0 ? (
              <p style={{ color: "#64748b", margin: 0 }}>{activeProgressTab === "words" ? "아직 단어 오답 기록이 없어요. [단어]에서 퀴즈를 풀어 보세요." : activeProgressTab === "sentences" ? "아직 문장 오답 기록이 없어요. [문장]에서 퀴즈를 풀어 보세요." : "아직 진도 기록이 없어요. 퀴즈를 풀면 학습 기록이 여기에 쌓여요."}</p>
            ) : key === "wrongKana" ? (
              <ul style={{ margin: 0, paddingLeft: 0 }}>
                {items.map((item, i) => (
                  <li key={`wrong-kana-item-${i}`} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", listStyle: "none" }}>
                    <div style={{ flex: 1 }}>{renderKanaItem(item, i)}</div>
                    <button
                      onClick={() => removeWrongKanaItem(item)}
                      style={{
                        fontSize: "0.75rem",
                        padding: "0.2rem 0.45rem",
                        cursor: "pointer",
                        background: "#fff",
                        border: "1px solid #ddd",
                        borderRadius: 4,
                        color: "#c00",
                        marginTop: "0.1rem",
                      }}
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                {items.map((item, i) => (
                  <li key={`wrong-item-${key}-${i}`} style={{ marginBottom: "0.35rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center" }}>
                      <span style={{ flex: 1 }}>{renderWordOrSentenceItem(item, i)}</span>
                      <button
                        onClick={() => {
                          if (key === "wrongWords") {
                            removeWrongWordItem(item);
                            return;
                          }
                          removeWrongSentenceItem(item);
                        }}
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.45rem",
                          cursor: "pointer",
                          background: "#fff",
                          border: "1px solid #ddd",
                          borderRadius: 4,
                          color: "#c00",
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
