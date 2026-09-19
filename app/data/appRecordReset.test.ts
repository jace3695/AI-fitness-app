import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { APP_RECORD_KEYS, RECORD_RESET_APPS, resetMarkerKey } from "./appRecordReset.ts";
import { applyCloudState, mergeCloudState, mergeCloudStateFromBase, mergeExplicitCloudBackup } from "./cloudSync.ts";

const fitnessMarker = resetMarkerKey("fitness");
const languageMarker = resetMarkerKey("language");
const stamp = "2026-09-06T12:00:00.000Z|reset-one";

test("운동 초기화는 오래된 기기의 운동 기록을 버리고 식단·설정 변경은 보존한다", () => {
  const base = { "ai-fitness-weight-records": { today: 82 }, "ai-fitness-water-intake": { today: 100 }, "ai-fitness-weight-goal": { minKg: 65 } };
  const remote = { ...base, [fitnessMarker]: stamp } as Record<string, unknown>;
  delete remote["ai-fitness-weight-records"];
  const local = { ...base, "ai-fitness-weight-records": { today: 81 }, "ai-fitness-water-intake": { today: 200 } };
  const merged = mergeCloudStateFromBase(base, remote, local);
  assert.equal("ai-fitness-weight-records" in merged, false);
  assert.deepEqual(merged["ai-fitness-water-intake"], { today: 200 });
  assert.deepEqual(merged["ai-fitness-weight-goal"], { minKg: 65 });
});

test("최초 동기화에도 일본어 초기화 이전 초안·복습을 되살리지 않는다", () => {
  const remote = { [languageMarker]: stamp, integratedLearningSettingsV1: '{"dailyMinutes":5}' };
  const local = { japaneseCurriculumProgressV1: '{"drafts":{"f01":{}}}', wrongWords: "[]", integratedLearningSettingsV1: '{"dailyMinutes":10}' };
  const merged = mergeCloudState(remote, local);
  assert.equal("japaneseCurriculumProgressV1" in merged, false);
  assert.equal("wrongWords" in merged, false);
  assert.equal(merged.integratedLearningSettingsV1, '{"dailyMinutes":10}');
});

test("초기화 이후 두 기기에서 새로 작성한 기록은 합친다", () => {
  const base = { [fitnessMarker]: stamp, "ai-fitness-weight-records": {} };
  const remote = { ...base, "ai-fitness-weight-records": { first: 81 } };
  const local = { ...base, "ai-fitness-weight-records": { second: 80 } };
  assert.deepEqual(mergeCloudStateFromBase(base, remote, local)["ai-fitness-weight-records"], { first: 81, second: 80 });
});

test("초기화 도중 도착한 이전 서버 응답이 새 초기화를 덮어쓰지 않는다", () => {
  const local = { [fitnessMarker]: stamp };
  const remote = { "ai-fitness-weight-records": { old: 82 } };
  assert.equal("ai-fitness-weight-records" in mergeCloudState(remote, local), false);
});

test("사용자가 직접 복원한 백업은 현재 초기화 기준을 유지하며 복구한다", () => {
  const current = { [fitnessMarker]: stamp, "ai-fitness-water-intake": { today: 100 } };
  const backup = { "ai-fitness-weight-records": { previous: 82 }, [fitnessMarker]: "2026-09-01T12:00:00.000Z|old" };
  const merged = mergeExplicitCloudBackup(current, backup);
  assert.equal(merged[fitnessMarker], stamp);
  assert.deepEqual(merged["ai-fitness-weight-records"], { previous: 82 });
  assert.deepEqual(merged["ai-fitness-water-intake"], { today: 100 });
});

test("초기화 대상을 앱끼리 공유하지 않고 로그인·설정 키를 포함하지 않는다", () => {
  const keys = RECORD_RESET_APPS.flatMap(app => [...APP_RECORD_KEYS[app]]);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.doesNotMatch(key, /token|password|pin|settings|goal|nav/i);
});

test("DB 트랜잭션의 삭제 키가 화면의 삭제 범위와 일치한다", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260906141943_add_app_record_resets.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  for (const app of ["fitness", "diet", "language"] as const) {
    const clause = sql.split(`when '${app}' then\n    record_keys := array[`)[1]?.split("];", 1)[0];
    assert.ok(clause, `${app} SQL scope missing`);
    assert.deepEqual(clause.match(/'([^']+)'/g)?.map(value => value.slice(1, -1)), APP_RECORD_KEYS[app]);
  }
});

test("클라우드의 삭제를 기기에 적용할 때 다른 앱과 인증 저장값은 유지한다", () => {
  const values = new Map<string, string>([["ai-fitness-weight-records", "{}"], ["savedWords", "[]"], ["sb-auth-token", "private"]]);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } } });
  try {
    applyCloudState({ [fitnessMarker]: stamp });
    assert.equal(values.has("ai-fitness-weight-records"), false);
    assert.equal(values.get("savedWords"), "[]");
    assert.equal(values.get("sb-auth-token"), "private");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
