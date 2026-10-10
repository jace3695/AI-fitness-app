"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GRAMMAR_LESSONS, GRAMMAR_PROGRESS_KEY, type GrammarProgressItem } from "@/data/grammar";
import type { RubySegment as WordRubySegment } from "@/data/words";
import type { RubySegment as SentenceRubySegment } from "@/data/sentences";
import { CURRICULUM_REVIEW_KEY, type CurriculumReviewItem } from "@/utils/curriculumProgress";
import { summarizeReviewMastery } from "@/utils/learningReview";
import { reviewFocus, type ReviewTrack } from "@/utils/reviewFocus";
import CourseReviewQuestion from "@/components/language/CourseReviewQuestion";
import { useLanguageRecordSnapshot } from "@/components/language/useLanguageRecordSnapshot";
import { useLanguageMutationAction } from "@/components/language/useLanguageMutationAction";
import { languageRowSource, type LanguageRowHandle } from "@/app/data/languageRecordIdentity";
import { projectReviewRows, projectReviewedItems, planReviewMutation, verifyCourseReview, type ReviewMutationPayload, type ReviewScheduleInput } from "@/app/data/languageReviewMutations";

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
const EMPTY_REVIEW_MESSAGE = "아직 복습할 항목이 없어요. 단어와 문장을 저장하거나 퀴즈를 풀면 복습에 모여요.";

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
  const source = useLanguageRecordSnapshot();
  const { context, snapshot, records } = source;
  const [reviewOpenedAt] = useState(() => Date.now());
  const date = getTodayLocalDateKey();
  const replayStarted = useRef(false);
  const [pinnedCourse, setPinnedCourse] = useState<{ item: CurriculumReviewItem; handle: LanguageRowHandle } | null>(null);
  const actions = useLanguageMutationAction(source, planReviewMutation);
  const scheduleAction = useLanguageMutationAction(source, planReviewMutation, { verify: verifyCourseReview });
  const replay = useLanguageMutationAction(source, planReviewMutation);
  const currentProjections = useMemo(() => ({
    words: projectReviewRows<Word>(snapshot, WORDS_KEY), sentences: projectReviewRows<Sentence>(snapshot, SENTENCES_KEY),
    grammar: projectReviewRows<GrammarProgressItem>(snapshot, GRAMMAR_PROGRESS_KEY), kana: projectReviewRows<WrongItem>(snapshot, WRONG_KANA_KEY),
    chars: projectReviewRows<string>(snapshot, WRONG_KANA_CHARS_KEY), wrongWords: projectReviewRows<WrongItem>(snapshot, WRONG_WORDS_KEY),
    wrongSentences: projectReviewRows<WrongItem>(snapshot, WRONG_SENTENCES_KEY), course: projectReviewRows<CurriculumReviewItem>(snapshot, CURRICULUM_REVIEW_KEY),
  }), [snapshot]);
  const retainedProjections = useRef(currentProjections);
  if (snapshot && !actions.pending && !scheduleAction.pending) retainedProjections.current = currentProjections;
  const projections = retainedProjections.current;
  const savedWords = projections.words.rows.map(row => row.value), savedSentences = projections.sentences.rows.map(row => row.value);
  const grammarRows = projections.grammar.rows.filter(row => row.value.wrongCount > 0 || row.value.lastResult === "wrong");
  const grammarReviewItems = grammarRows.map(row => row.value), wrongKana = projections.kana.rows.map(row => row.value), wrongKanaChars = projections.chars.rows.map(row => row.value);
  const wrongWords = projections.wrongWords.rows.map(row => row.value), wrongSentences = projections.wrongSentences.rows.map(row => row.value);
  const curriculumReviewItems = projections.course.rows.map(row => row.value);
  const retainedReviewed = useRef(records.reviewCompletedItemsByDate);
  if (snapshot && !actions.pending && !scheduleAction.pending) retainedReviewed.current = records.reviewCompletedItemsByDate;
  const reviewed = projectReviewedItems(retainedReviewed.current, date), reviewedItemIds = reviewed.items;
  const projectionError = Object.values(projections).find(value => value.error)?.error || reviewed.error;
  const courseSaveError = scheduleAction.error || actions.error || replay.error;
  useEffect(() => {
    if (replayStarted.current || !context || !snapshot) return;
    replayStarted.current = true;
    void replay.submit({ kind: "reconcile-completion" });
  }, [context, snapshot, replay]);
  const kanaReviewCount = new Set([...wrongKana.map(item => typeof item === "string" ? item : typeof item.char === "string" ? item.char : ""), ...wrongKanaChars].filter(Boolean)).size;
  const deleteWithHandle = (payload: ReviewMutationPayload, handle: LanguageRowHandle) => actions.submit(payload, () => { if (pinnedCourse?.handle.viewId === handle.viewId) setPinnedCourse(null); }, languageRowSource(handle));
  const handleDeleteWord = (word: Word) => { const row = projections.words.rows.find(row => row.value === word); if (row) void deleteWithHandle({ kind: "delete-group", key: WORDS_KEY, handle: row.handle }, row.handle); };
  const handleDeleteSentence = (sentence: Sentence) => { const row = projections.sentences.rows.find(row => row.value === sentence); if (row) void deleteWithHandle({ kind: "delete-group", key: SENTENCES_KEY, handle: row.handle }, row.handle); };
  const handleDeleteWrongWord = (handle: LanguageRowHandle) => deleteWithHandle({ kind: "delete-row", key: WRONG_WORDS_KEY, handle }, handle);
  const handleDeleteWrongSentence = (handle: LanguageRowHandle) => deleteWithHandle({ kind: "delete-row", key: WRONG_SENTENCES_KEY, handle }, handle);
  const handleDeleteGrammarReviewItem = (handle: LanguageRowHandle) => deleteWithHandle({ kind: "delete-group", key: GRAMMAR_PROGRESS_KEY, handle }, handle);
  const handleDeleteWrongKana = (handle: LanguageRowHandle) => deleteWithHandle({ kind: "delete-row", key: WRONG_KANA_KEY, handle, cleanupKana: true }, handle);
  const handleDeleteWrongKanaChar = (handle: LanguageRowHandle) => deleteWithHandle({ kind: "delete-row", key: WRONG_KANA_CHARS_KEY, handle }, handle);
  const handleDeleteCurriculumReview = async (handle: LanguageRowHandle) => {
    if (scheduleAction.isPending() || actions.isPending()) return false;
    if (!window.confirm("이 문제를 복습에서 삭제할까요? 수업 기록은 유지돼요.")) return false;
    return deleteWithHandle({ kind: "delete-group", key: CURRICULUM_REVIEW_KEY, handle }, handle);
  };
  const scheduleCurriculumReview = (handle: LanguageRowHandle, input: ReviewScheduleInput) => {
    if (actions.isPending()) return Promise.resolve(false);
    return scheduleAction.submit({ kind: "schedule", handle, ...input }, () => setPinnedCourse(null), languageRowSource(handle));
  };
  const trackReviewAction = (itemId: string) => {
    if (scheduleAction.isPending()) return;
    void actions.submit({ kind: "reviewed", itemId });
  };
  const isReviewed = (itemId: string) => reviewedItemIds.includes(itemId);
  const reviewActionButtonStyle = (done: boolean) => ({
    borderColor: done ? "#22c55e" : "#2563eb",
    background: done ? "#22c55e" : "#2563eb",
    color: "#fff",
    boxShadow: done ? "0 6px 14px rgba(34, 197, 94, 0.24)" : "0 8px 18px rgba(37, 99, 235, 0.22)",
  });

  const [focusTrack, setFocusTrack] = useState<ReviewTrack>("all");
  const [focusedId, setFocusedId] = useState("");
  const focusItems = reviewFocus(curriculumReviewItems, reviewOpenedAt, focusTrack);
  const showWords = activeReviewTab === "all" || activeReviewTab === "words";
  const showCourse = activeReviewTab === "all" || activeReviewTab === "course";
  const showSentences = activeReviewTab === "all" || activeReviewTab === "sentences";
  const showGrammar = activeReviewTab === "all" || activeReviewTab === "grammar";
  const showKana = activeReviewTab === "all" || activeReviewTab === "kana";
  const dueCurriculumReviewItems = curriculumReviewItems.filter((item) => !item.nextReviewAt || new Date(item.nextReviewAt).getTime() <= reviewOpenedAt);

  const selectedCourseItems = pinnedCourse ? [pinnedCourse] : (dueCurriculumReviewItems.find(item => item.id === focusedId) ? dueCurriculumReviewItems.filter(item => item.id === focusedId) : focusItems.length ? focusItems.slice(0, 1) : dueCurriculumReviewItems.slice(0, 1)).flatMap(item => {
    const row = projections.course.rows.find(row => row.value === item); return row ? [{ item, handle: row.handle }] : [];
  });


  return (
    <section>
      {!snapshot && <p role="status">{source.error || "학습 기록을 확인하고 있어요. 입력은 보존됩니다."}</p>}
      <div hidden={!snapshot} inert={!snapshot}>
      {projectionError && <p role="alert">{projectionError}</p>}
      {courseSaveError && <p role="alert">{courseSaveError}</p>}
      {[["복습 저장", actions], ["과정 복습 저장", scheduleAction], ["기존 완료 확인", replay]].map(([label, control]) => {
        const action = control as typeof actions;
        return action.pending ? <div key={label as string} role="status"><span>{label as string} 확인이 필요해요.</span><button type="button" disabled={action.busy} onClick={() => void action.retry()}>저장 다시 확인</button>{action.canResubmit && <button type="button" disabled={action.busy} onClick={() => void action.resubmit()}>최신 상태에서 새로 저장</button>}</div> : null;
      })}
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

      <section className="card" aria-label="집중 복습 추천" style={{ marginBottom:14 }}>
        <h2>먼저 확인할 문제</h2><p className="muted">복습일이 된 문제 중 최근 힌트를 사용한 문제, 누적 오답이 많은 문제 순서입니다. 기록만으로 전체 일본어 실력을 평가하지 않습니다.</p>
        <label>관심 복습 분야<select aria-label="관심 복습 분야" value={focusTrack} onChange={event=>{setFocusTrack(event.target.value as ReviewTrack);setFocusedId('');}} style={{minHeight:44,marginLeft:8}}><option value="all">전체</option><option value="foundation">기초</option><option value="work">업무</option><option value="travel">여행</option></select></label>
        {focusItems.length?<ul>{focusItems.map(item=><li key={item.id} style={{marginTop:12}}><strong>{item.lessonTitle}</strong><p>{item.prompt}</p><p className="muted">누적 오답 {item.wrongCount??0}회{item.lastNeededHelp?' · 최근 힌트 사용':''}{item.lastModality?` · ${item.lastModality==='listening'?'듣기':item.lastModality==='typing'?'입력':'뜻 확인'}`:''}</p><button className="btn" onClick={()=>{setFocusedId(item.id);setActiveReviewTab('course');}}>이 문제 먼저 복습</button></li>)}</ul>:<p className="muted">선택한 분야에서 복습일이 된 문제는 없습니다.</p>}
        <div style={{display:'flex',flexWrap:'wrap',gap:12,marginTop:16}}><Link className="btn" href="/language/learn?lesson=w21">도면·공차 수업</Link><Link className="btn" href="/language/learn?lesson=w22">측정·품질 수업</Link></div>
      </section>

      <section className="card" aria-label="복습 숙련도" style={{ marginBottom: 14 }}>
        <h2>연습한 문제의 숙련도</h2>
        <p className="muted">힌트 없이 3번 이상 맞히고 복습 간격이 7일 이상인 문제를 안정으로 표시해요. 발음·필기 품질을 채점한 결과는 아니에요.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{summarizeReviewMastery(curriculumReviewItems).map(item => <p key={item.modality}><strong>{item.label}</strong><br />안정 {item.stable} / 측정 {item.observed}문제</p>)}</div>
        <details><summary>무료 복습 간격 계산 기준</summary><p>1·3·7·14·30일 순서로 늘려요. 힌트나 오답이 있으면 다음 날 다시 보고, 정답에 시간이 오래 걸리면 현재 간격을 유지해요. 기준은 선택 12초·듣기 25초·입력 30초이며, 화면이 숨겨진 시간은 제외합니다. 측정은 이번 화면에서 보낸 시간만 포함해요.</p></details>
      </section>

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

      {(showCourse || pinnedCourse) && (
        <div hidden={!showCourse}>
          <div className="section-title"><h2>오늘 복습할 과정 문제</h2><span className="count">{dueCurriculumReviewItems.length}개</span></div>
          {courseSaveError && <p role="alert">{courseSaveError}</p>}
          {selectedCourseItems.length === 0 ? <div className="empty-state">오늘 예정된 과정 복습을 모두 마쳤어요. 전체 보관 항목은 {curriculumReviewItems.length}개예요. <Link href="/language/learn">[배우기]</Link>에서 다음 수업을 시작해 보세요.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px" }}>
              {selectedCourseItems.map(({ item, handle }) => <CourseReviewQuestion key={handle.viewId} item={item} handle={handle} onDirty={() => setPinnedCourse(previous => previous ?? { item, handle })} pending={!snapshot || scheduleAction.pending || actions.pending} onSchedule={scheduleCurriculumReview} onDelete={handleDeleteCurriculumReview} />)}
            </ul>
          )}
        </div>
      )}

      {showWords && (
        <>
          <div className="section-title"><h2>저장한 단어</h2><span className="count">{savedWords.length}개</span></div>
          {savedWords.length === 0 ? <div className="empty-state">{EMPTY_REVIEW_MESSAGE} <Link href="/language/words">[단어]</Link>에서 단어를 저장해 보세요.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {savedWords.map((w, idx) => (
                <li key={projections.words.rows[idx].handle.viewId} className="card" style={{ marginBottom: "14px", overflowWrap: "anywhere", wordBreak: "break-word", border: "1px solid #dbeafe", borderRadius: "16px", boxShadow: "0 8px 20px rgba(15,23,42,.06)" }}>
                  <div className="card-top"><div className="jp-text">{w.word}</div><div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}><span className="badge">{w.category}</span>{partOfSpeechLabels[normalizePartOfSpeech(w.partOfSpeech)] && <span className="badge">{partOfSpeechLabels[normalizePartOfSpeech(w.partOfSpeech)]}</span>}</div></div>
                  <div style={{ marginTop: "12px" }}><div className="label">뜻</div><div>{w.meaning}</div></div>
                  <div style={{ marginTop: "10px" }}><div className="label">예문</div><div style={{ color: "#555" }}>{w.example}</div></div>
                  <div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Link href="/language/words" className="btn">단어 다시 학습</Link>
                    <Link href={`/language/sentences?word=${encodeURIComponent(w.sentenceKeyword || w.word)}`} className="btn">관련 문장 보기</Link>
                    <button
                      type="button"
                      disabled={actions.pending || scheduleAction.pending} onClick={() => trackReviewAction(`saved-word:${w.word}`)}
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
              {wrongWords.map((item, idx) => { const itemId = buildWrongItemId("wrong-word", item); return <li key={projections.wrongWords.rows[idx].handle.viewId} className="card" style={{ marginBottom: "10px", overflowWrap: "anywhere", border: "1px solid #dbeafe" }}><div style={{ marginBottom: "8px" }}><WrongItemText item={item} /></div><div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}><Link href="/language/words" className="btn">단어 다시 학습</Link><button type="button" disabled={actions.pending || scheduleAction.pending} onClick={() => trackReviewAction(itemId)} className="btn" style={reviewActionButtonStyle(isReviewed(itemId))}>{isReviewed(itemId) ? "복습 완료됨" : "복습 완료"}</button><button type="button" onClick={() => handleDeleteWrongWord(projections.wrongWords.rows[idx].handle)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button></div></li>; })}
            </ul>
          )}
        </>
      )}

      {showSentences && (
        <>
          <div className="section-title"><h2>저장한 문장</h2><span className="count">{savedSentences.length}개</span></div>
          {savedSentences.length === 0 ? <div className="empty-state">{EMPTY_REVIEW_MESSAGE} <Link href="/language/sentences">[문장]</Link>에서 문장을 저장해 보세요.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {savedSentences.map((s, idx) => (
                <li key={projections.sentences.rows[idx].handle.viewId} className="card" style={{ marginBottom: "14px", overflowWrap: "anywhere", wordBreak: "break-word", border: "1px solid #dbeafe", borderRadius: "16px", boxShadow: "0 8px 20px rgba(15,23,42,.06)" }}>
                  <div className="card-top"><div className="jp-text">{s.japanese}</div><div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}><span className="badge">{s.category}</span>{s.pattern && <span className="badge">{sentencePatternLabels[s.pattern] ?? "기타"}</span>}</div></div>
                  <div style={{ marginTop: "12px" }}><div className="label">뜻</div><div>{s.meaning}</div></div>
                  <div style={{ marginTop: "10px" }}><div className="label">설명</div><div style={{ color: "#555" }}>{s.note}</div></div>
                  <div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Link href="/language/sentences" className="btn">문장 다시 학습</Link>
                    <button
                      type="button"
                      disabled={actions.pending || scheduleAction.pending} onClick={() => trackReviewAction(`saved-sentence:${s.japanese}`)}
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
              {wrongSentences.map((item, idx) => { const itemId = buildWrongItemId("wrong-sentence", item); return <li key={projections.wrongSentences.rows[idx].handle.viewId} className="card" style={{ marginBottom: "10px", overflowWrap: "anywhere", border: "1px solid #dbeafe" }}><div style={{ marginBottom: "8px" }}><WrongItemText item={item} /></div><div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}><Link href="/language/sentences" className="btn">문장 다시 학습</Link><button type="button" disabled={actions.pending || scheduleAction.pending} onClick={() => trackReviewAction(itemId)} className="btn" style={reviewActionButtonStyle(isReviewed(itemId))}>{isReviewed(itemId) ? "복습 완료됨" : "복습 완료"}</button><button type="button" onClick={() => handleDeleteWrongSentence(projections.wrongSentences.rows[idx].handle)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button></div></li>; })}
            </ul>
          )}
        </>
      )}

      {showGrammar && (
        <>
          <div className="section-title"><h2>문법 복습</h2><span className="count">{grammarReviewItems.length}개</span></div>
          {grammarReviewItems.length === 0 ? <div className="empty-state">{EMPTY_REVIEW_MESSAGE} <Link href="/language/grammar">[문법]</Link>에서 연습 문제를 풀어 보세요.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {grammarReviewItems.map((item, idx) => (
                <li key={grammarRows[idx].handle.viewId} className="card" style={{ marginBottom: "14px", overflowWrap: "anywhere", border: "1px solid #dbeafe", borderRadius: "16px", boxShadow: "0 8px 20px rgba(15,23,42,.06)" }}>
                  {(() => {
                    const lesson = GRAMMAR_LESSONS.find((entry) => entry.id === item.lessonId);
                    return (
                      <>
                  <div className="card-top"><div className="jp-text">{item.title}</div><div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}><span className="badge">{item.category}</span><span className="badge">{item.pattern}</span></div></div>
                  <div style={{ marginTop: "10px", fontSize: "14px" }}>오답 {item.wrongCount}회 · 최근 결과: {item.lastResult === "correct" ? "정답" : "오답"}</div>
                  <div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}><button type="button" disabled={actions.pending || scheduleAction.pending} onClick={() => trackReviewAction(`grammar:${item.lessonId}`)} className="btn" style={reviewActionButtonStyle(isReviewed(`grammar:${item.lessonId}`))}>{isReviewed(`grammar:${item.lessonId}`) ? "복습 완료됨" : "복습 완료"}</button><Link href={`/language/grammar?lesson=${item.lessonId}`} className="btn">문법 다시 학습</Link><button type="button" onClick={() => handleDeleteGrammarReviewItem(grammarRows[idx].handle)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button></div>
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
                  <li key={projections.kana.rows[idx].handle.viewId} className="card" style={{ marginBottom: "10px", overflowWrap: "anywhere", border: "1px solid #dbeafe" }}>
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontSize: "30px", fontWeight: 700, lineHeight: 1.2, color: "#0f172a" }}>{parsed.char || "가나 정보 없음"}</div>
                      <div style={{ marginTop: "4px", color: "#475569", fontSize: "14px" }}>
                        {parsed.typeLabel}{parsed.romaji ? ` · ${parsed.romaji}` : ""}
                      </div>
                      <div style={{ marginTop: "6px", color: "#334155", fontSize: "13px" }}>복습 사유: {parsed.modeLabel}</div>
                    </div>
                    <div className="card-actions" style={{ justifyContent: "flex-end", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <Link href="/language/kana" className="btn">가나 다시 학습</Link>
                      <button type="button" disabled={actions.pending || scheduleAction.pending} onClick={() => trackReviewAction(itemId)} className="btn" style={reviewActionButtonStyle(isReviewed(itemId))}>{isReviewed(itemId) ? "복습 완료됨" : "복습 완료"}</button>
                      <button type="button" onClick={() => handleDeleteWrongKana(projections.kana.rows[idx].handle)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="section-title"><h2>헷갈린 글자</h2><span className="count">{wrongKanaChars.length}개</span></div>
          {wrongKanaChars.length === 0 ? <div className="empty-state">헷갈린 글자가 없습니다.</div> : (
            <div className="card" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px", border: "1px solid #dbeafe" }}>{wrongKanaChars.map((char, idx) => { const itemId = `kana-char:${char}`; return <div key={projections.chars.rows[idx].handle.viewId} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", borderRadius: "999px", background: "#f8fbff" }}><span className="badge" style={{ fontSize: "18px" }}>{char}</span><button type="button" disabled={actions.pending || scheduleAction.pending} onClick={() => trackReviewAction(itemId)} className="btn" style={reviewActionButtonStyle(isReviewed(itemId))}>{isReviewed(itemId) ? "복습 완료됨" : "복습 완료"}</button><button type="button" onClick={() => handleDeleteWrongKanaChar(projections.chars.rows[idx].handle)} className="btn" style={{ borderColor: "#ef4444", color: "#dc2626", background: "#fff5f5" }}>삭제</button></div>; })}</div>
          )}

          <div className="card-actions" style={{ justifyContent: "flex-end", marginBottom: "18px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Link href="/language/kana" className="btn">가나 다시 학습</Link>
          </div>
        </>
      )}

      </div>
    </section>
  );
}
