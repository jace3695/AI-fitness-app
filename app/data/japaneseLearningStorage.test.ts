import assert from "node:assert/strict";
import test from "node:test";
import { CURRICULUM } from "../../data/curriculum.ts";
import { CURRICULUM_PROGRESS_KEY, loadCurriculumProgress, saveCurriculumProgress } from "../../utils/curriculumProgress.ts";
import { INTEGRATED_LEARNING_SETTINGS_KEY, loadIntegratedLearningSettings } from "../../utils/integratedLearningSettings.ts";
import { answerSessionQuestion, createLearningSession, normalizeLearningSession, withLearningSessionDraft } from "../../utils/learningSession.ts";
import { prepareLanguageLocalState } from "./languageCloudSync.ts";

class MemoryStorage {
  values = new Map<string, string>();
  failWrites = false;
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrites) throw new DOMException("Storage full", "QuotaExceededError"); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}

function withStorage(run: (storage: MemoryStorage) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  try { run(localStorage); }
  finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
}

test("기존 학습 기록과 설정을 새 화면에서 읽어도 기록을 초기화하지 않는다", () => withStorage((storage) => {
  storage.setItem(CURRICULUM_PROGRESS_KEY, JSON.stringify({ completedLessonIds: ["f01"], selectedTrack: "work", quizScores: { f01: 75 }, activityDates: ["2026-09-05"], lessonAttempts: { f01: [{ score: 75, completedAt: "2026-09-05T09:00:00Z" }] } }));
  storage.setItem(INTEGRATED_LEARNING_SETTINGS_KEY, JSON.stringify({ dailyMinutes: 20, showMeaning: false, preferredTrack: "work" }));
  const before = storage.getItem(CURRICULUM_PROGRESS_KEY);
  assert.deepEqual(loadCurriculumProgress().completedLessonIds, ["f01"]);
  assert.equal(loadCurriculumProgress().quizScores.f01, 75);
  assert.equal(loadIntegratedLearningSettings().dailyMinutes, 20);
  assert.equal(loadIntegratedLearningSettings().showMeaning, false);
  assert.equal(loadIntegratedLearningSettings().showCompanion, true);
  assert.equal(storage.getItem(CURRICULUM_PROGRESS_KEY), before);
}));

test("새로고침에 해당하는 재조회에서 분량·문제·첫 오답·진행 위치가 복원된다", () => withStorage(() => {
  const lesson = CURRICULUM[0];
  let draft = createLearningSession(lesson.id, 5, "starter");
  draft = { ...answerSessionQuestion(draft, 2, false, "오답"), stage: 4, quizCursor: 1 };
  saveCurriculumProgress(withLearningSessionDraft(loadCurriculumProgress(), draft));
  const restored = normalizeLearningSession(loadCurriculumProgress().lessonDrafts?.[lesson.id], lesson);
  assert.deepEqual(restored, draft);
}));

test("저장 공간 오류를 호출자에게 전달하며 기존 성공 기록은 유지한다", () => withStorage((storage) => {
  saveCurriculumProgress({ ...loadCurriculumProgress(), completedLessonIds: ["f01"] });
  const before = storage.getItem(CURRICULUM_PROGRESS_KEY);
  storage.failWrites = true;
  assert.throws(() => saveCurriculumProgress({ ...loadCurriculumProgress(), completedLessonIds: ["f01", "f02"] }), /Storage full/);
  assert.equal(storage.getItem(CURRICULUM_PROGRESS_KEY), before);
}));

test("계정 준비 시 이전 계정의 새 수업 초안도 함께 격리한다", () => withStorage((storage) => {
  prepareLanguageLocalState("test-account-a");
  saveCurriculumProgress(withLearningSessionDraft(loadCurriculumProgress(), createLearningSession("f01", 5, "starter")));
  storage.setItem("unrelated-test-key", "preserve");
  prepareLanguageLocalState("test-account-b");
  assert.equal(loadCurriculumProgress().activeSession, undefined);
  assert.equal(storage.getItem("unrelated-test-key"), "preserve");
}));
