import assert from "node:assert/strict";
import test from "node:test";
import { mergeCloudStateFromBase } from "./cloudSync";

test("서로 다른 날짜의 기록을 함께 보존한다", () => {
  assert.deepEqual(
    mergeCloudStateFromBase(
      { records: {} },
      { records: { "2026-08-01": { water: 2 } } },
      { records: { "2026-08-02": { protein: 1 } } },
    ),
    {
      records: {
        "2026-08-01": { water: 2 },
        "2026-08-02": { protein: 1 },
      },
    },
  );
});

test("삭제와 수정이 충돌하면 수정 기록을 보존한다", () => {
  assert.deepEqual(
    mergeCloudStateFromBase(
      { records: { today: { water: 1 } } },
      { records: {} },
      { records: { today: { water: 2 } } },
    ),
    { records: { today: { water: 2 } } },
  );
});

test("한 기기만 삭제한 값은 삭제한다", () => {
  assert.deepEqual(
    mergeCloudStateFromBase(
      { records: { today: { water: 1 } } },
      { records: {} },
      { records: { today: { water: 1 } } },
    ),
    { records: {} },
  );
});

test("두 기기에서 추가한 운동 세트를 함께 보존한다", () => {
  assert.deepEqual(
    mergeCloudStateFromBase(
      { sets: [] },
      { sets: [{ exercise: "버드독", count: 10 }] },
      { sets: [{ exercise: "데드버그", count: 10 }] },
    ),
    {
      sets: [
        { exercise: "버드독", count: 10 },
        { exercise: "데드버그", count: 10 },
      ],
    },
  );
});

test("같은 날짜에서 서로 다른 항목 수정을 함께 보존한다", () => {
  assert.deepEqual(
    mergeCloudStateFromBase(
      { records: { today: { water: 1, protein: 1 } } },
      { records: { today: { water: 2, protein: 1 } } },
      { records: { today: { water: 1, protein: 2 } } },
    ),
    { records: { today: { water: 2, protein: 2 } } },
  );
});
