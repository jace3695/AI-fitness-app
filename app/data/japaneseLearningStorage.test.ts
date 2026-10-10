import assert from "node:assert/strict";
import test from "node:test";
import { CURRICULUM } from "../../data/curriculum.ts";
import { CURRICULUM_PROGRESS_KEY, loadCurriculumProgress } from "../../utils/curriculumProgress.ts";
import { INTEGRATED_LEARNING_SETTINGS_KEY, loadIntegratedLearningSettings } from "../../utils/integratedLearningSettings.ts";
import { answerSessionQuestion, createLearningSession, normalizeLearningSession, withLearningSessionDraft } from "../../utils/learningSession.ts";
import { prepareLocalCloudState } from "./cloudSync.ts";
import { readGuardedLanguageProjection } from "./languageStorageBoundary.ts";
import { commitLanguageSyncResponse, readLanguageRecordSnapshot } from "./languageCloudSync.ts";
import { createCourseMutation, runCourseMutation } from "./languageCourseMutations.ts";
import { languageFixture } from "../../tests/helpers/languageFixture.ts";

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
  assert.deepEqual(loadCurriculumProgress(storage.getItem(CURRICULUM_PROGRESS_KEY)).completedLessonIds, ["f01"]);
  assert.equal(loadCurriculumProgress(storage.getItem(CURRICULUM_PROGRESS_KEY)).quizScores.f01, 75);
  assert.equal(loadIntegratedLearningSettings(storage.getItem(INTEGRATED_LEARNING_SETTINGS_KEY)).dailyMinutes, 20);
  assert.equal(loadIntegratedLearningSettings(storage.getItem(INTEGRATED_LEARNING_SETTINGS_KEY)).showMeaning, false);
  assert.equal(loadIntegratedLearningSettings(storage.getItem(INTEGRATED_LEARNING_SETTINGS_KEY)).showCompanion, true);
  assert.equal(storage.getItem(CURRICULUM_PROGRESS_KEY), before);
}));

test("새로고침에 해당하는 재조회에서 분량·문제·첫 오답·진행 위치가 복원된다", async t => {
  const f = languageFixture(); t.after(f.restore);
  const { request } = await f.request(); const { context } = await commitLanguageSyncResponse(request, {});
  const lesson = CURRICULUM[0];
  let draft = createLearningSession(lesson.id, 5, "starter");
  draft = { ...answerSessionQuestion(draft, 2, false, "오답"), stage: 4, quizCursor: 1 };
  await runCourseMutation(createCourseMutation(context, readLanguageRecordSnapshot(context), { kind: "draft", lesson, session: draft }));
  const restored = normalizeLearningSession(loadCurriculumProgress(f.storage.getItem(CURRICULUM_PROGRESS_KEY)).lessonDrafts?.[lesson.id], lesson);
  assert.deepEqual(restored, draft);
});

test("저장 공간 오류를 호출자에게 전달하며 기존 성공 기록은 유지한다", async t => {
  const f = languageFixture(); t.after(f.restore);
  const { request } = await f.request(); const { context } = await commitLanguageSyncResponse(request, { [CURRICULUM_PROGRESS_KEY]: '{"completedLessonIds":["f01"]}' });
  const before = f.storage.getItem(CURRICULUM_PROGRESS_KEY); const set = f.storage.setItem; let failed = false;
  f.storage.setItem = (key, value) => { if (key === CURRICULUM_PROGRESS_KEY && !failed) { failed = true; throw new Error("Storage full"); } set(key, value); };
  await assert.rejects(runCourseMutation(createCourseMutation(context, readLanguageRecordSnapshot(context), { kind: "track", track: "work" })), /Storage full/);
  assert.equal(f.storage.getItem(CURRICULUM_PROGRESS_KEY), before);
});

test("계정 준비 시 이전 계정의 새 수업 초안도 함께 격리한다", async t => {
  const fixture = languageFixture(); t.after(fixture.restore);
  const storage = fixture.storage;
  await prepareLocalCloudState("test-account-a");
  storage.setItem(CURRICULUM_PROGRESS_KEY, JSON.stringify(withLearningSessionDraft(loadCurriculumProgress(storage.getItem(CURRICULUM_PROGRESS_KEY)), createLearningSession("f01", 5, "starter"))));
  const original = storage.getItem(CURRICULUM_PROGRESS_KEY);
  storage.setItem("unrelated-test-key", "preserve");
  await prepareLocalCloudState("test-account-b");
  // Approved held-in-place policy: B cannot read A's draft, and unknown backup is never silently deleted.
  assert.equal(readGuardedLanguageProjection(storage).status, "unavailable");
  assert.equal(storage.getItem(CURRICULUM_PROGRESS_KEY), original);
  assert.equal(storage.getItem("unrelated-test-key"), "preserve");
  await prepareLocalCloudState("test-account-a");
  assert.equal(readGuardedLanguageProjection(storage).status, "ready");
  assert.ok(loadCurriculumProgress(storage.getItem(CURRICULUM_PROGRESS_KEY)).activeSession);
});
