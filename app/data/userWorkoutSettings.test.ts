import assert from "node:assert/strict";
import test from "node:test";
import { RECORDS_CHANGED_EVENT } from "./storageTransaction.ts";
import {
  EMPTY_USER_WORKOUT_SETTINGS,
  saveUserWorkoutSettings,
  USER_WORKOUT_SETTINGS_KEY,
} from "./userWorkoutSettings.ts";

test("운동 설정 저장은 공통 클라우드 동기화에 즉시 변경을 알린다", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const browserWindow = Object.assign(new EventTarget(), { localStorage: storage });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserWindow,
  });
  let notifications = 0;
  browserWindow.addEventListener(RECORDS_CHANGED_EVENT, () => {
    notifications += 1;
  });

  try {
    saveUserWorkoutSettings({
      ...EMPTY_USER_WORKOUT_SETTINGS,
      weeklyExerciseTargets: { mon: { "덤벨 고블릿 스쿼트": { reps: 12, weightKg: 5.5 } } },
    });
    await Promise.resolve();
    assert.equal(notifications, 1);
    assert.equal(
      JSON.parse(values.get(USER_WORKOUT_SETTINGS_KEY) ?? "{}").weeklyExerciseTargets.mon["덤벨 고블릿 스쿼트"].weightKg,
      5.5,
    );
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});
