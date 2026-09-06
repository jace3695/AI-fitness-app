import type { CurriculumLesson } from "../data/curriculum";
import type { CurriculumProgress, CurriculumReviewItem } from "./curriculumProgress";

export type LearnerMode = "starter" | "reader";
export type LearningMinutes = 5 | 10 | 20;
export type LearningSession = {
  version: 1;
  id: string;
  lessonId: string;
  minutes: LearningMinutes;
  mode: LearnerMode;
  stage: number;
  wordIndex: number;
  quizCursor: number;
  answers: Record<number, boolean>;
  firstAnswers: Record<number, boolean>;
  responses: Record<number, string>;
  speakingChecks: boolean[];
};

export function createLearningSession(lessonId: string, minutes: LearningMinutes, mode: LearnerMode): LearningSession {
  return { version: 1, id: globalThis.crypto.randomUUID(), lessonId, minutes, mode, stage: 0, wordIndex: 0, quizCursor: 0, answers: {}, firstAnswers: {}, responses: {}, speakingChecks: [false, false, false] };
}

export function getSessionQuizIndices(lesson: CurriculumLesson, minutes: LearningMinutes): number[] {
  const indices = lesson.quiz.map((_, index) => index);
  // The generated vocabulary checks cover all three words, even in a short
  // session. Preserve their source indices so existing review IDs stay valid.
  const vocabulary = indices.filter((index) => index >= 2 && lesson.quiz[index].kind !== "input" && lesson.quiz[index].kind !== "listening");
  if (minutes === 5) return (vocabulary.length >= 3 ? vocabulary : indices).slice(0, 3);
  if (minutes === 10) return indices.filter((index) => lesson.quiz[index].kind !== "input").slice(0, 5);
  return indices;
}

export function normalizeLearningSession(value: unknown, lesson: CurriculumLesson): LearningSession | undefined {
  if (!value || typeof value !== "object") return;
  const draft = value as Partial<LearningSession>;
  if (draft.version !== 1 || draft.lessonId !== lesson.id || ![5, 10, 20].includes(draft.minutes ?? 0)) return;
  if (draft.mode !== "starter" && draft.mode !== "reader") return;
  const clean = createLearningSession(lesson.id, draft.minutes as LearningMinutes, draft.mode);
  if (typeof draft.id === "string" && draft.id.length <= 100 && draft.id.length > 0) clean.id = draft.id;
  const bounded = (number: unknown, max: number) => typeof number === "number" && Number.isInteger(number) ? Math.max(0, Math.min(number, max)) : 0;
  clean.stage = bounded(draft.stage, 4);
  clean.wordIndex = bounded(draft.wordIndex, lesson.words.length - 1);
  clean.quizCursor = bounded(draft.quizCursor, getSessionQuizIndices(lesson, clean.minutes).length - 1);
  const answerMap = (map: unknown): Record<number, boolean> => !map || typeof map !== "object" ? {} : Object.fromEntries(Object.entries(map).filter(([key, result]) => /^\d+$/.test(key) && Number(key) < lesson.quiz.length && typeof result === "boolean"));
  clean.answers = answerMap(draft.answers);
  clean.firstAnswers = answerMap(draft.firstAnswers);
  clean.responses = draft.responses && typeof draft.responses === "object" ? Object.fromEntries(Object.entries(draft.responses).filter(([key, result]) => /^\d+$/.test(key) && Number(key) < lesson.quiz.length && typeof result === "string" && result.length < 500)) : {};
  clean.speakingChecks = Array.from({ length: 3 }, (_, index) => draft.speakingChecks?.[index] === true);
  return clean;
}

export function answerSessionQuestion(session: LearningSession, index: number, correct: boolean, response: string): LearningSession {
  return { ...session, answers: { ...session.answers, [index]: correct }, firstAnswers: { ...session.firstAnswers, [index]: session.firstAnswers[index] ?? correct }, responses: { ...session.responses, [index]: response } };
}

export function withLearningSessionDraft(progress: CurriculumProgress, session: LearningSession): CurriculumProgress {
  const drafts = { ...progress.lessonDrafts };
  // Preserve the original single-draft format when moving to another lesson.
  if (progress.activeSession?.lessonId) drafts[progress.activeSession.lessonId] = progress.activeSession;
  drafts[session.lessonId] = session;
  return { ...progress, activeSession: session, lessonDrafts: drafts };
}

export function withoutLearningSessionDraft(progress: CurriculumProgress, session: LearningSession): CurriculumProgress {
  const drafts = { ...progress.lessonDrafts };
  // A newer session opened in another tab must not be cleared by an older one.
  if (drafts[session.lessonId]?.id === session.id) delete drafts[session.lessonId];
  return { ...progress, lessonDrafts: drafts, activeSession: progress.activeSession?.id === session.id ? Object.values(drafts).at(-1) : progress.activeSession };
}

export function retrySessionQuestion(session: LearningSession, index: number): LearningSession {
  const answers = { ...session.answers };
  const responses = { ...session.responses };
  delete answers[index];
  delete responses[index];
  return { ...session, answers, responses };
}

export function getSessionResult(lesson: CurriculumLesson, session: LearningSession) {
  const indices = getSessionQuizIndices(lesson, session.minutes);
  const answered = indices.filter((index) => typeof session.answers[index] === "boolean").length;
  const correct = indices.filter((index) => session.answers[index] === true).length;
  const firstCorrect = indices.filter((index) => session.firstAnswers[index] === true).length;
  return { total: indices.length, answered, correct, firstCorrect, score: Math.round(firstCorrect / indices.length * 100), complete: answered === indices.length, needsPractice: correct < indices.length };
}

export function getQuestionChoices(lesson: CurriculumLesson, index: number, mode: LearnerMode) {
  const quiz = lesson.quiz[index];
  const expected = quiz.choices[quiz.answer];
  const choices = quiz.kind === "input" && mode === "starter"
    ? [expected, ...lesson.words.map((word) => word.japanese).filter((word) => word !== expected)].slice(0, 3)
    : quiz.choices;
  const unique = [...new Set(choices)];
  const offset = (index + lesson.order) % unique.length;
  return [...unique.slice(offset), ...unique.slice(0, offset)].map((label) => ({ label, correct: label === expected }));
}

export function isTypedAnswerCorrect(lesson: CurriculumLesson, index: number, response: string): boolean {
  const normalize = (value: string) => value.normalize("NFKC").replace(/[\s。、,.!?！？]/g, "").toLowerCase();
  const expected = lesson.quiz[index].choices[lesson.quiz[index].answer];
  const word = lesson.words.find((item) => item.japanese === expected);
  return [expected, word?.reading].filter((item): item is string => Boolean(item)).some((item) => normalize(item) === normalize(response));
}

export function getNextReviewInterval(current = 0): number {
  return [1, 3, 7, 14, 30].find((days) => days > current) ?? 30;
}

export function updateSessionReviews(existing: CurriculumReviewItem[], lesson: CurriculumLesson, session: LearningSession, now: Date): CurriculumReviewItem[] {
  const updated = new Map(existing.map((item) => [item.id, item]));
  for (const index of getSessionQuizIndices(lesson, session.minutes)) {
    if (session.answers[index] === undefined) continue;
    const id = lesson.id + ":" + index;
    const previous = updated.get(id);
    const repeatedSave = previous?.lastSessionId === session.id;
    if (repeatedSave && previous.lastSessionResult === session.answers[index]) continue;
    const firstWrong = session.firstAnswers[index] === false;
    if (!firstWrong && session.answers[index] && !previous) continue;
    const intervalDays = session.answers[index] === false ? 0 : firstWrong ? 1 : getNextReviewInterval(previous?.intervalDays);
    updated.set(id, {
      ...previous, id, lastSessionId: session.id, lastSessionResult: session.answers[index], lessonId: lesson.id, lessonTitle: lesson.title,
      prompt: lesson.quiz[index].prompt, explanation: lesson.quiz[index].explanation,
      createdAt: previous?.createdAt ?? now.toISOString(),
      wrongCount: (previous?.wrongCount ?? 0) + (firstWrong && !repeatedSave ? 1 : 0),
      lastWrongAt: firstWrong && !repeatedSave ? now.toISOString() : previous?.lastWrongAt,
      intervalDays, nextReviewAt: new Date(now.getTime() + intervalDays * 86_400_000).toISOString(),
    });
  }
  // Unasked questions and unrelated lessons remain untouched.
  return [...updated.values()];
}
