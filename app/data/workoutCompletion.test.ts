import assert from "node:assert/strict";
import test from "node:test";
import {
  isCardioDone,
  isPullupDone,
  isWorkoutPerformed,
  removeCardioRecord,
  removeFoamRollerRecord,
  removeGeneralWorkoutRecord,
  removePullupRecord,
  type WorkoutDayRecord,
} from "./workoutCompletion.ts";

test("일반 운동 삭제 시 다른 운동 종류의 기록을 모두 보존한다", () => {
  const record: WorkoutDayRecord = {
    workoutDone: true,
    workoutRoutineName: "허리 강화",
    workoutStatus: "completed",
    workoutMemo: "일반 운동 메모",
    workoutExerciseRecords: [
      { exerciseName: "버드독", status: "completed" },
    ],
    workoutMethod: { method: "circuit", rounds: 3, restSeconds: 60, workSeconds: 30 },
    workoutRecordedAt: "2026-08-28T07:30:00.000Z",
    cardioDone: true,
    cardioType: "슬라이딩보드",
    cardioMinutes: 30,
    cardioMemo: "유산소 메모",
    rosaryCardioDone: true,
    rosaryCardioMinutes: 20,
    rosaryDecades: 5,
    postWorkoutCardioDone: true,
    postWorkoutCardioMinutes: 10,
    pullupDone: true,
    pullupStage: 2,
    pullupExerciseNames: ["짧은 매달리기"],
    pullupMemo: "철봉 메모",
    foamRollerDone: true,
    foamRollerTiming: "after",
    foamRollerAreas: ["등"],
    foamRollerMemo: "폼롤러 메모",
  };

  const preserved = removeGeneralWorkoutRecord(record);

  assert.equal(isWorkoutPerformed(preserved), false);
  assert.equal(isCardioDone(preserved), true);
  assert.equal(isPullupDone(preserved), true);
  assert.deepEqual(preserved, {
    cardioDone: true,
    cardioType: "슬라이딩보드",
    cardioMinutes: 30,
    cardioMemo: "유산소 메모",
    rosaryCardioDone: true,
    rosaryCardioMinutes: 20,
    rosaryDecades: 5,
    postWorkoutCardioDone: true,
    postWorkoutCardioMinutes: 10,
    pullupDone: true,
    pullupStage: 2,
    pullupExerciseNames: ["짧은 매달리기"],
    pullupMemo: "철봉 메모",
    foamRollerDone: true,
    foamRollerTiming: "after",
    foamRollerAreas: ["등"],
    foamRollerMemo: "폼롤러 메모",
  });
});

test("일반 운동만 있던 기록은 빈 객체가 된다", () => {
  assert.deepEqual(
    removeGeneralWorkoutRecord({
      workoutDone: false,
      workoutStatus: "partial",
      workoutDifficulty: "moderate",
      workoutFatigue: 2,
    }),
    {},
  );
});

test("종류별 삭제는 선택한 기록만 제거하고 나머지를 보존한다", () => {
  const record: WorkoutDayRecord = {
    workoutDone: true,
    workoutStatus: "completed",
    cardioDone: true,
    cardioType: "실내 걷기",
    cardioMinutes: 25,
    cardioMemo: "가볍게",
    pullupDone: true,
    pullupStage: 1,
    pullupExerciseNames: ["견갑 내리기"],
    pullupPain: false,
    pullupMemo: "안정적",
    foamRollerDone: true,
    foamRollerTiming: "after",
    foamRollerAreas: ["종아리"],
    foamRollerPain: false,
    foamRollerMemo: "시원함",
  };

  const withoutCardio = removeCardioRecord(record);
  assert.equal(withoutCardio.cardioDone, undefined);
  assert.equal(withoutCardio.pullupDone, true);
  assert.equal(withoutCardio.foamRollerDone, true);
  assert.equal(withoutCardio.workoutDone, true);

  const withoutPullup = removePullupRecord(record);
  assert.equal(withoutPullup.pullupDone, undefined);
  assert.equal(withoutPullup.cardioDone, true);
  assert.equal(withoutPullup.foamRollerDone, true);
  assert.equal(withoutPullup.workoutDone, true);

  const withoutFoamRoller = removeFoamRollerRecord(record);
  assert.equal(withoutFoamRoller.foamRollerDone, undefined);
  assert.equal(withoutFoamRoller.cardioDone, true);
  assert.equal(withoutFoamRoller.pullupDone, true);
  assert.equal(withoutFoamRoller.workoutDone, true);
});
