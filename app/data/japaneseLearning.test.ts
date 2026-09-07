import assert from "node:assert/strict";
import test from "node:test";
import { WORDS } from "../../data/words.ts";
import { SENTENCES } from "../../data/sentences.ts";
import { GRAMMAR_LESSONS } from "../../data/grammar.ts";
import { CURRICULUM } from "../../data/curriculum.ts";
import { EXPANDED_WORDS, toKoreanPronunciation } from "../../data/learningDataExpansion.ts";
import { RECOMMENDED_WORDS } from "../../data/recommendedDataExpansion.ts";
import { createVocabularyExample, getVocabularyLevel, getVocabularyPartOfSpeech, isNumberPracticeWord } from "../../data/japaneseLearningQuality.ts";
import { answerSessionQuestion, createLearningSession, getQuestionChoices, getSessionQuizIndices, getSessionResult, isTypedAnswerCorrect, normalizeLearningSession, retrySessionQuestion, updateSessionReviews } from "../../utils/learningSession.ts";
import { withLearningSessionDraft, withoutLearningSessionDraft } from "../../utils/learningSession.ts";
import { BEGINNER_KANA_GROUPS } from "../../data/beginnerKana.ts";
import { DEFAULT_CURRICULUM_PROGRESS } from "../../utils/curriculumProgress.ts";

test("일본어 자료는 필수 필드와 고유 식별자를 유지한다", () => {
  assert.equal(WORDS.length, new Set(WORDS.map((item) => item.word)).size);
  assert.equal(SENTENCES.length, new Set(SENTENCES.map((item) => item.japanese)).size);
  assert.equal(CURRICULUM.length, 60);
  assert.equal(GRAMMAR_LESSONS.length, 40);
  for (const word of WORDS) assert.ok(word.word && word.meaning && word.reading && word.exampleReading && word.exampleMeaning);
  for (const sentence of SENTENCES) assert.ok(sentence.japanese && sentence.meaning && sentence.reading);
  for (const lesson of CURRICULUM) {
    assert.equal(lesson.quiz.length, 8);
    for (const quiz of lesson.quiz) assert.ok(quiz.choices[quiz.answer] && quiz.explanation);
  }
});

test("첫 가나는 다섯 글자로 시작하며 46글자를 중복 없이 나눈다", () => {
  assert.equal(BEGINNER_KANA_GROUPS[0].chars, "あいうえお");
  const all = BEGINNER_KANA_GROUPS.flatMap((group) => [...group.chars]);
  assert.equal(all.length, 46);
  assert.equal(new Set(all).size, 46);
  for (const group of BEGINNER_KANA_GROUPS) assert.equal([...group.chars].length, group.sounds.length);
});

test("첫 자료 목록에는 숫자 묶음 대신 짧은 표현이 충분히 남는다", () => {
  assert.ok(WORDS.filter((item) => item.practiceGroup !== "numbers" && item.level === "beginner").length >= 50);
  assert.ok(SENTENCES.filter((item) => item.practiceGroup !== "numbers" && item.level === "beginner").length >= 15);
  assert.equal(SENTENCES.find((item) => item.japanese === "パンを食べます。")?.level, "beginner");
  assert.equal(WORDS.find((item) => item.word === "美味しい")?.partOfSpeech, "i-adjective");
});

test("수업을 바꿔도 이전 초안을 보존하고 해당 세션만 정리한다", () => {
  const first = createLearningSession("f01", 5, "starter");
  const second = createLearningSession("f02", 20, "reader");
  const progress = withLearningSessionDraft({ ...DEFAULT_CURRICULUM_PROGRESS, activeSession: first }, second);
  assert.equal(progress.lessonDrafts?.f01.id, first.id);
  assert.equal(progress.lessonDrafts?.f02.id, second.id);
  const finished = withoutLearningSessionDraft(progress, second);
  assert.equal(finished.lessonDrafts?.f02, undefined);
  assert.equal(finished.activeSession?.id, first.id);
  const newer = createLearningSession("f02", 10, "reader");
  const concurrent = withLearningSessionDraft(progress, newer);
  assert.equal(withoutLearningSessionDraft(concurrent, second).activeSession?.id, newer.id);
});

test("저장 재시도는 동일 세션의 오답 횟수와 복습 간격을 중복 변경하지 않는다", () => {
  const lesson = CURRICULUM[0];
  const session = answerSessionQuestion(createLearningSession(lesson.id, 5, "starter"), 2, false, "오답");
  const once = updateSessionReviews([], lesson, session, new Date("2026-09-06T09:00:00Z"));
  const retry = updateSessionReviews(once, lesson, session, new Date("2026-09-06T09:01:00Z"));
  assert.deepEqual(retry, once);
  assert.equal(normalizeLearningSession(JSON.parse(JSON.stringify(session)), lesson)?.id, session.id);
  const corrected = answerSessionQuestion(retrySessionQuestion(session, 2), 2, true, "정답");
  const correctedSave = updateSessionReviews(retry, lesson, corrected, new Date("2026-09-06T09:02:00Z"));
  assert.equal(correctedSave[0].wrongCount, 1);
  assert.equal(correctedSave[0].intervalDays, 1);
});

test("숫자 및 단위를 일반 명사의 끝 글자와 혼동하지 않는다", () => {
  for (const value of ["一", "三日", "六十分", "二十四時", "四人"]) assert.equal(isNumberPracticeWord(value), true);
  for (const value of ["休日", "記念日", "案内人", "自分"]) assert.equal(isNumberPracticeWord(value), false);
  assert.doesNotMatch(createVocabularyExample("休日", "きゅうじつ", "휴일").japanese, /予約日は/);
  assert.equal(WORDS.filter((item) => item.practiceGroup === "numbers").length, 467);
});

test("단어의 난이도는 순서와 무관하고 품사는 명시적으로 구분한다", () => {
  for (const value of ["一", "二", "三", "水", "トイレ"]) assert.equal(getVocabularyLevel(value, "여행"), "beginner");
  assert.equal(getVocabularyLevel("再発防止", "업무"), "practical");
  assert.equal(getVocabularyPartOfSpeech("嬉しい"), "i-adjective");
  assert.equal(getVocabularyPartOfSpeech("大きい"), "i-adjective");
  assert.equal(getVocabularyPartOfSpeech("綺麗"), "na-adjective");
  assert.equal(getVocabularyPartOfSpeech("食べる"), "verb");
});

test("자동 확장 예문은 동사·형용사에 명사 접속을 붙이지 않는다", () => {
  for (const item of [...EXPANDED_WORDS, ...RECOMMENDED_WORDS]) {
    if (item.partOfSpeech === "verb" || item.partOfSpeech === "i-adjective") {
      for (const suffix of ["を覚えます", "について", "が必要", "を確認"]) assert.equal(item.example.includes(item.word + suffix), false, item.example);
    }
  }
  assert.equal(WORDS.find((item) => item.word === "嬉しい")?.example, "嬉しいです。");
  assert.equal(RECOMMENDED_WORDS.find((item) => item.word === "食べる")?.example, "パンを食べます。");
});

test("장음·인사와 숫자 예문의 조사 발음 보조를 구분한다", () => {
  assert.equal(toKoreanPronunciation("ほーむ"), "호오무");
  assert.equal(toKoreanPronunciation("こーひー"), "코오히이");
  assert.equal(toKoreanPronunciation("こんにちは"), "콘니치와");
  assert.equal(toKoreanPronunciation("パーティー"), "파아티이");
  assert.match(EXPANDED_WORDS.find((item) => item.word === "一")?.exampleKoreanPronunciation ?? "", /코타에와/);
  assert.equal(EXPANDED_WORDS.find((item) => item.word === "二十四時")?.reading, "にじゅうよじ");
});

test("문법은 서로 다른 예문·보기와 유효한 정답을 제공한다", () => {
  for (const lesson of GRAMMAR_LESSONS) {
    const examples = lesson.examples.map((item) => item.japanese);
    assert.equal(examples.length, new Set(examples).size);
    for (const item of lesson.examples) {
      assert.doesNotMatch(item.japanese, /かか|^例：/);
      assert.doesNotMatch(item.meaning, /습니다인가요|세요인가요|인가요\?인가요/);
    }
    const choices = lesson.quiz.choices.map((item) => typeof item === "string" ? item : item.text);
    assert.equal(new Set(choices).size, choices.length);
    assert.ok(choices.includes(lesson.quiz.answer));
  }
  assert.ok(GRAMMAR_LESSONS.some((lesson) => lesson.level !== "beginner"));
});

test("5분·10분·20분의 문제 수와 기존 복습 식별자를 유지한다", () => {
  const lesson = CURRICULUM[0];
  assert.deepEqual(getSessionQuizIndices(lesson, 5), [2, 4, 6]);
  assert.equal(getSessionQuizIndices(lesson, 10).length, 5);
  assert.equal(getSessionQuizIndices(lesson, 20).length, 8);
  for (const item of CURRICULUM) for (const minutes of [5, 10, 20] as const) assert.ok(getSessionQuizIndices(item, minutes).length > 0);
});

test("입문 모드의 입력 문제는 선택으로 풀 수 있고 정답 위치가 고정되지 않는다", () => {
  const lesson = CURRICULUM[0];
  const inputIndex = lesson.quiz.findIndex((quiz) => quiz.kind === "input");
  const choices = getQuestionChoices(lesson, inputIndex, "starter");
  assert.equal(choices.length, 3);
  assert.equal(choices.filter((choice) => choice.correct).length, 1);
  assert.ok(getQuestionChoices(lesson, 2, "starter").some((choice, index) => choice.correct && index !== 0) || getQuestionChoices(lesson, 4, "starter").some((choice, index) => choice.correct && index !== 0));
});

test("다시 맞혀도 첫 시도 점수를 덮어쓰지 않고 재연습 성취를 따로 계산한다", () => {
  const lesson = CURRICULUM[0];
  let session = createLearningSession(lesson.id, 5, "starter");
  session = answerSessionQuestion(session, 2, false, "오답");
  session = retrySessionQuestion(session, 2);
  session = answerSessionQuestion(session, 2, true, "정답");
  session = answerSessionQuestion(session, 4, true, "정답");
  session = answerSessionQuestion(session, 6, true, "정답");
  assert.deepEqual(getSessionResult(lesson, session), { total: 3, answered: 3, correct: 3, firstCorrect: 2, score: 67, complete: true, needsPractice: false });
});

test("전부 틀린 상태는 이해 완료로 표시되지 않는다", () => {
  const lesson = CURRICULUM[0];
  let session = createLearningSession(lesson.id, 5, "starter");
  for (const index of getSessionQuizIndices(lesson, 5)) session = answerSessionQuestion(session, index, false, "오답");
  assert.equal(getSessionResult(lesson, session).needsPractice, true);
  const reviews = updateSessionReviews([], lesson, session, new Date("2026-09-06T01:00:00Z"));
  assert.equal(reviews.length, 3);
  assert.equal(reviews[0].nextReviewAt, "2026-09-06T01:00:00.000Z");
});

test("짧은 학습을 저장해도 출제하지 않은 오답은 삭제되지 않는다", () => {
  const lesson = CURRICULUM[0];
  const old = { id: "f01:7", lessonId: "f01", lessonTitle: "기존", prompt: "기존", explanation: "기존", createdAt: "2026-09-01T00:00:00Z" };
  let session = createLearningSession(lesson.id, 5, "starter");
  session = answerSessionQuestion(session, 2, false, "오답");
  session = answerSessionQuestion(session, 2, true, "정답");
  const reviews = updateSessionReviews([old], lesson, session, new Date("2026-09-06T01:00:00Z"));
  assert.deepEqual(reviews.find((item) => item.id === old.id), old);
  assert.equal(reviews.find((item) => item.id === "f01:2")?.intervalDays, 1);
});

test("수업 초안은 다른 수업으로 섞이지 않고 범위를 벗어난 상태를 제한한다", () => {
  const lesson = CURRICULUM[0];
  const draft = { ...createLearningSession(lesson.id, 10, "starter"), stage: 99, quizCursor: 99, answers: { 0: true, 999: true, 1: "bad" } };
  const restored = normalizeLearningSession(draft, lesson);
  assert.equal(restored?.stage, 4);
  assert.equal(restored?.quizCursor, 4);
  assert.deepEqual(restored?.answers, { 0: true });
  assert.equal(normalizeLearningSession(draft, CURRICULUM[1]), undefined);
});

test("직접 입력은 공백·문장 부호와 단어 읽기 입력을 허용한다", () => {
  const lesson = CURRICULUM[2];
  const index = lesson.quiz.findIndex((quiz) => quiz.kind === "input");
  const expected = lesson.quiz[index].choices[0];
  const reading = lesson.words.find((word) => word.japanese === expected)!.reading;
  assert.equal(isTypedAnswerCorrect(lesson, index, " " + reading + "。"), true);
  assert.equal(isTypedAnswerCorrect(lesson, index, "아무 답"), false);
});
